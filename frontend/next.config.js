/** @type {import('next').NextConfig} */

// The Rust API runs on its own port. We proxy `/api/*` to it via a rewrite so
// the browser always talks to the Next.js origin — that keeps the session
// cookie first-party (httpOnly, SameSite=Lax), exactly like QuartzFire's model.
// Override with QC_API_URL when the backend is elsewhere.
const API_URL = process.env.QC_API_URL || "http://127.0.0.1:8080";

const nextConfig = {
  // Self-contained production build (server.js + only the traced node_modules)
  // so the deb/rpm packages don't have to ship the full dependency tree.
  // lucide-react resolves from the repo-root package.json, so the tracing root
  // must be the repo root — the standalone tree then nests under `frontend/`.
  output: "standalone",
  experimental: {
    outputFileTracingRoot: require("path").join(__dirname, ".."),
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

module.exports = nextConfig;
