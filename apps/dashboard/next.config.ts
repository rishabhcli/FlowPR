import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: ['@flowpr/schemas', '@flowpr/tools'],
};

export default nextConfig;
