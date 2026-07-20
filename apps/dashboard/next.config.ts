import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Dashboard is accessed via the Apache proxy at this hostname, not localhost directly.
  allowedDevOrigins: ["backdash.babawha.local"],
};

export default nextConfig;
