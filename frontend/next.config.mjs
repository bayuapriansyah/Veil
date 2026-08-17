/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The runtime imports TypeScript modules from the repo's `services/` tree.
  // Next transpiles them through the same SWC pipeline as local code.
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;