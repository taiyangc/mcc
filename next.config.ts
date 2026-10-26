import type { NextConfig } from "next";

// Next.js 16.4 uses the TypeScript CLI by default, including for TypeScript 7.
const nextConfig: NextConfig = {
  serverExternalPackages: ["talib"],
  outputFileTracingIncludes: {
    "/api/chart-alerts": ["./node_modules/talib/build/Release/talib.node"],
  },
};

export default nextConfig;
