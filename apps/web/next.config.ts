import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@ai-intel/db", "@ai-intel/shared"],
};

export default nextConfig;

