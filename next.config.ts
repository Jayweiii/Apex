import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["gpmf-extract", "gopro-telemetry"],
};

export default nextConfig;
