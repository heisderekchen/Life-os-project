import type { NextConfig } from "next";
import path from "path";
import withBundleAnalyzer from "@next/bundle-analyzer";

const config = withBundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});
const staticExport = process.env.LIFEOS_STATIC_EXPORT === "true";

const nextConfig: NextConfig = {
  output: staticExport ? "export" : "standalone",
  // The integrated static app and its API both stay on HappySpa's origin.
  basePath: process.env.LIFEOS_BASE_PATH || undefined,
  ...(staticExport ? {} : {
    // Pin the tracing root for the standalone Docker build.
    outputFileTracingRoot: path.join(__dirname),
  }),
  typescript: {
    // Type errors must be resolved before shipping — do not suppress them.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  ...(!staticExport ? {
    async headers() {
      return [{
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: [
            "default-src 'self'", "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:",
            "font-src 'self' data:", "connect-src 'self'", "frame-ancestors 'none'",
          ].join("; ") },
        ],
      }];
    },
    // Standalone upstream deployments may use the Rust backend. The integrated
    // static build uses HappySpa's same-origin D1 APIs instead.
    async rewrites() {
      const backend = process.env.BACKEND_URL || "http://localhost:8080";
      const proxy = (prefix: string) => [
        { source: prefix, destination: `${backend}${prefix}` },
        { source: `${prefix}/:path*`, destination: `${backend}${prefix}/:path*` },
      ];
      return [
        ...proxy("/api/tasks"), ...proxy("/api/projects"), ...proxy("/api/notes"),
        ...proxy("/api/note-folders"), ...proxy("/api/tags"), ...proxy("/api/journal"),
        ...proxy("/api/habits"), ...proxy("/api/habit-logs"), ...proxy("/api/goals"),
        ...proxy("/api/events"), ...proxy("/api/time-entries"), ...proxy("/api/pomodoro-sessions"),
        ...proxy("/api/courses"), ...proxy("/api/finance"), ...proxy("/api/profile"),
        ...proxy("/api/notifications"), ...proxy("/api/search"), ...proxy("/api/activity"),
        ...proxy("/api/dashboard"), ...proxy("/api/analytics"), ...proxy("/api/weekly-review"),
        ...proxy("/api/data"),
      ];
    },
  } : {}),
};

export default config(nextConfig);
