import type { NextConfig } from "next";
const api = process.env.API_URL ?? "http://localhost:4000";
const config: NextConfig = {
  transpilePackages: ["@resonance/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://s.ytimg.com https://w.soundcloud.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; frame-src https://www.youtube.com https://w.soundcloud.com; connect-src 'self' ws: wss: https://www.youtube.com https://w.soundcloud.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
