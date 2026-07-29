import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // TypeScript 7's native compiler does not expose the JS compiler API that
    // Next.js uses for type checking, so drive `tsc` through its CLI instead.
    useTypeScriptCli: true,
  },
};

export default nextConfig;
