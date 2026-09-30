import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    resolveAlias: {
      // @mujoco/mujoco (Emscripten ESM) does `await import('module')` in its Node-only path.
      module: { browser: "./src/lib/empty-module.ts" },
    },
  },
  async headers() {
    return [
      {
        // Large static assets that never change between deploys of the same data.
        source: "/(robots|mujoco)/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" }],
      },
    ];
  },
};

export default nextConfig;
