import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Railway runs the built server from node_modules, so a standalone bundle
  // is not needed; the default output keeps `next start` working as-is.
  serverExternalPackages: ["@prisma/client", "prisma", "twilio", "@aws-sdk/client-s3"],
};

export default nextConfig;
