/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The runtime imports TypeScript modules from the repo's `services/` tree.
  // Next transpiles them through the same SWC pipeline as local code.
  experimental: {
    externalDir: true,
  },
  // Exclude optional heavy modules that wagmi/connectors pulls in via
  // @base-org/account → @coinbase/cdp-sdk → @x402/* but are never used.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@coinbase/cdp-sdk': false,
      '@x402/evm': false,
      '@x402/svm': false,
    };
    return config;
  },
};

export default nextConfig;