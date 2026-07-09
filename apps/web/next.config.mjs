/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @vaep/types is consumed as TypeScript source, so let Next transpile it.
  transpilePackages: ['@vaep/types'],
};

export default nextConfig;
