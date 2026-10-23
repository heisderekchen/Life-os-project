# MyOS iPhone HealthKit app

This small native iOS app opens the existing MyOS `/workbench/` site in a same-origin, HTTPS-only `WKWebView` and exposes a read-only HealthKit summary bridge to the fitness page. MyOS authentication remains in the existing web app.

## Build and configure

1. Generate/open the Xcode project with XcodeGen (`xcodegen generate --spec project.yml`).
2. In the app target, select the Apple Developer Team and replace the sample bundle identifier with the registered MyOS iOS App ID. Keep the HealthKit capability enabled; the checked-in entitlement and `NSHealthShareUsageDescription` are required for authorization to work.
3. Build and install on a physical iPhone. In the app, enter the HTTPS MyOS host, then sign in through the existing MyOS login page.
4. Open Fitness → Connect Apple Health and grant the requested read-only access. The app returns up to 30 workout summaries from the last 30 days, including duration, distance, active energy and average/peak heart rate when those samples exist.

The iOS Simulator can verify build and launch, but it cannot verify the user's real HealthKit records. Before distribution, use the production App ID, publish the approved privacy disclosure and complete a physical-device permission and data-flow test. The app does not write HealthKit data or send it to the coach unless the user separately selects that option in MyOS.
