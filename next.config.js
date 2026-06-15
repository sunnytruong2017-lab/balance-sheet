/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // xlsx uses Node built-ins — never bundle it for the browser
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        stream: false,
        crypto: false,
        path: false,
        zlib: false,
      };
    }
    return config;
  },
  // Tell Next.js to treat xlsx as a server-only external package
  serverExternalPackages: ["xlsx"],
};

module.exports = nextConfig;
