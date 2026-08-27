/** @type {import('next').NextConfig} */
const nextConfig = {
  // Strict mode double-invokes effects, which would boot a second renderer and
  // Rapier world and leak the first pair.
  reactStrictMode: false,

  // Stops `next dev` writing AGENTS.md / CLAUDE.md into the project root.
  agentRules: false,

  // Force every `three` import onto the WebGPU build. Without this the addons
  // pull in a second copy of the library and cross-build `instanceof` checks
  // silently fail. Exact match only, so `three/addons/*` still resolves.
  turbopack: {
    resolveAlias: { three: 'three/webgpu' },
  },
  webpack: (config) => {
    config.resolve.alias = { ...config.resolve.alias, three$: 'three/webgpu' };
    config.experiments = { ...config.experiments, topLevelAwait: true };
    return config;
  },

  // Keeps the door open for SharedArrayBuffer-backed Rapier builds.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Embedder-Policy', value: 'credentialless' },
        ],
      },
    ];
  },
};

export default nextConfig;
