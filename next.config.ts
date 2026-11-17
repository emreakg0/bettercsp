import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Include the server-only local adapter data in deployment artifacts.
  outputFileTracingIncludes: { "/*": ["./data/rutgers/*.json"] },
};

export default nextConfig;
