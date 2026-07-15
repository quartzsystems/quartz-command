/** @type {import('next').NextConfig} */

// The Rust API runs on its own port. We proxy `/api/*` to it via a rewrite so
// the browser always talks to the Next.js origin — that keeps the session
// cookie first-party (httpOnly, SameSite=Lax), exactly like QuartzFire's model.
// Override with QC_API_URL when the backend is elsewhere.
const API_URL = process.env.QC_API_URL || "http://127.0.0.1:8080";

const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

module.exports = nextConfig;
