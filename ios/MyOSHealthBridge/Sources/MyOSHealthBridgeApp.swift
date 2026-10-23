import SwiftUI
import WebKit
import HealthKit

@main
struct MyOSHealthBridgeApp: App {
    @AppStorage("myosBaseURL") private var myosBaseURL = ""

    var body: some Scene {
        WindowGroup {
            if let url = MyOSAddress.normalizedURL(myosBaseURL) {
                HealthWebView(url: url)
                    .ignoresSafeArea(edges: .bottom)
            } else {
                MyOSAddressView(value: $myosBaseURL)
            }
        }
    }
}

private enum MyOSAddress {
    static func normalizedURL(_ value: String) -> URL? {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard var components = URLComponents(string: text), components.scheme?.lowercased() == "https",
              let host = components.host, !host.isEmpty, components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else { return nil }
        if components.path.isEmpty || components.path == "/" {
            components.path = "/workbench/"
        } else if components.path == "/workbench" {
            components.path = "/workbench/"
        } else if !components.path.hasPrefix("/workbench/") {
            return nil
        }
        return components.url
    }
}

private struct MyOSAddressView: View {
    @Binding var value: String
    @State private var draft = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Connect to MyOS") {
                    TextField("https://your-myos-host/workbench/", text: $draft)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text("Use the HTTPS address for your Life OS workspace. The app keeps its web login in the iOS web view.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Button("Open MyOS") {
                        if let url = MyOSAddress.normalizedURL(draft) { value = url.absoluteString }
                    }
                    .disabled(MyOSAddress.normalizedURL(draft) == nil)
                }
            }
            .navigationTitle("MyOS")
        }
    }
}

private struct HealthWebView: UIViewRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(allowedURL: url) }

    func makeUIView(context: Context) -> WKWebView {
        let content = WKUserContentController()
        content.add(context.coordinator, name: "myosHealthKit")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = content
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))
        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard webView.url?.absoluteString != url.absoluteString else { return }
        context.coordinator.setAllowedURL(url)
        webView.load(URLRequest(url: url))
    }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private(set) var allowedHost: String
        private(set) var allowedPort: Int
        private let health = MyOSHealthKitReader()

        init(allowedURL: URL) {
            allowedHost = allowedURL.host ?? ""
            allowedPort = allowedURL.port ?? 443
        }

        func setAllowedURL(_ url: URL) {
            allowedHost = url.host ?? ""
            allowedPort = url.port ?? 443
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let target = navigationAction.request.url,
                  target.scheme?.lowercased() == "https", target.host?.lowercased() == allowedHost.lowercased(),
                  (target.port ?? 443) == allowedPort,
                  target.path == "/" || target.path == "/workbench" || target.path.hasPrefix("/workbench/") else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "myosHealthKit",
                  let body = message.body as? [String: Any],
                  body["action"] as? String == "readSummary",
                  let requestId = body["requestId"] as? String,
                  UUID(uuidString: requestId) != nil else { return }

            let origin = message.frameInfo.securityOrigin
            let originPort = origin.port == 0 && origin.protocol.lowercased() == "https" ? 443 : origin.port
            guard message.frameInfo.isMainFrame,
                  origin.protocol.lowercased() == "https",
                  origin.host.lowercased() == allowedHost.lowercased(),
                  originPort == allowedPort else {
                send(["requestId": requestId, "ok": false, "error": "HEALTH_BRIDGE_ORIGIN_REJECTED"])
                return
            }

            let daysBack = min(max(body["daysBack"] as? Int ?? 30, 1), 30)
            Task {
                do {
                    let workouts = try await health.readWorkoutSummaries(daysBack: daysBack)
                    send(["requestId": requestId, "ok": true,
                          "summary": ["periodDays": daysBack, "workouts": workouts]])
                } catch {
                    let code = (error as? MyOSHealthKitError)?.responseCode ?? "HEALTH_READ_FAILED"
                    send(["requestId": requestId, "ok": false, "error": code])
                }
            }
        }

        private func send(_ payload: [String: Any]) {
            guard let data = try? JSONSerialization.data(withJSONObject: payload, options: [.fragmentsAllowed, .sortedKeys]),
                  let json = String(data: data, encoding: .utf8) else { return }
            webView?.evaluateJavaScript("window.__myosHealthKitReceive && window.__myosHealthKitReceive(\(json));")
        }
    }
}

private enum MyOSHealthKitError: Error {
    case unavailable
    case authorizationFailed
    case queryFailed

    var responseCode: String {
        switch self {
        case .unavailable: return "HEALTH_DATA_UNAVAILABLE"
        case .authorizationFailed: return "HEALTH_AUTHORIZATION_FAILED"
        case .queryFailed: return "HEALTH_QUERY_FAILED"
        }
    }
}

@MainActor
private final class MyOSHealthKitReader {
    private let store = HKHealthStore()

    func readWorkoutSummaries(daysBack: Int) async throws -> [[String: Any]] {
        guard HKHealthStore.isHealthDataAvailable() else { throw MyOSHealthKitError.unavailable }
        let workoutType = HKObjectType.workoutType()
        let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate)!
        let energy = HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        let walkingDistance = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!
        let cyclingDistance = HKObjectType.quantityType(forIdentifier: .distanceCycling)!
        do {
            try await store.requestAuthorization(toShare: [], read: [workoutType, heartRate, energy, walkingDistance, cyclingDistance])
        } catch {
            throw MyOSHealthKitError.authorizationFailed
        }

        let start = Calendar.current.date(byAdding: .day, value: -daysBack, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: Date(), options: .strictStartDate)
        let workouts: [HKWorkout]
        do {
            workouts = try await queryWorkouts(predicate: predicate)
        } catch {
            throw MyOSHealthKitError.queryFailed
        }
        var summaries: [[String: Any]] = []
        for workout in workouts.prefix(30) {
            let (average, peak) = await heartRateStats(for: workout, type: heartRate)
            summaries.append([
                "activity": activityName(workout.workoutActivityType),
                "startedAt": ISO8601DateFormatter().string(from: workout.startDate),
                "durationMinutes": Int((workout.duration / 60).rounded()),
                "distanceKm": workout.totalDistance.map { $0.doubleValue(for: .meter()) / 1000 } as Any? ?? NSNull(),
                "activeEnergyKcal": workout.totalEnergyBurned.map { $0.doubleValue(for: .kilocalorie()) } as Any? ?? NSNull(),
                "averageHeartRateBpm": average as Any? ?? NSNull(),
                "peakHeartRateBpm": peak as Any? ?? NSNull(),
            ])
        }
        return summaries
    }

    private func queryWorkouts(predicate: NSPredicate) async throws -> [HKWorkout] {
        try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(sampleType: .workoutType(), predicate: predicate, limit: 30,
                                      sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)]) { _, samples, error in
                if let error { continuation.resume(throwing: error); return }
                continuation.resume(returning: samples as? [HKWorkout] ?? [])
            }
            store.execute(query)
        }
    }

    private func heartRateStats(for workout: HKWorkout, type: HKQuantityType) async -> (Double?, Double?) {
        await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: HKQuery.predicateForObjects(from: workout),
                                          options: [.discreteAverage, .discreteMax]) { _, statistics, _ in
                let unit = HKUnit.count().unitDivided(by: .minute())
                continuation.resume(returning: (statistics?.averageQuantity()?.doubleValue(for: unit),
                                                statistics?.maximumQuantity()?.doubleValue(for: unit)))
            }
            store.execute(query)
        }
    }

    private func activityName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .running: return "Running"
        case .walking: return "Walking"
        case .cycling: return "Cycling"
        case .traditionalStrengthTraining: return "Strength training"
        case .functionalStrengthTraining: return "Functional strength"
        case .highIntensityIntervalTraining: return "HIIT"
        case .yoga: return "Yoga"
        case .swimming: return "Swimming"
        default: return "Workout"
        }
    }
}
