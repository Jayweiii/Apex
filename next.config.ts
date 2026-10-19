import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["gpmf-extract", "gopro-telemetry"],
  async redirects() {
    return [
      {
        source: "/discover",
        destination: "/lap-comparisons",
        permanent: true,
      },
      {
        source: "/youtube",
        destination: "/",
        permanent: false,
      },
      {
        source: "/friends",
        destination: "/lap-comparisons?tab=sessions",
        permanent: false,
      },
      {
        // Legacy per-lap pages → session page with that lap selected.
        source: "/sessions/:id/laps/:lapId",
        destination: "/sessions/:id?lap=:lapId",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
