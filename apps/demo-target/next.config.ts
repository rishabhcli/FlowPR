import { join } from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Parallel Playwright runs use separate ports and must not share Next's dev cache.
  ...(process.env.DEMO_TARGET_PORT ? { distDir: `.next-${process.env.DEMO_TARGET_PORT}` } : {}),
  outputFileTracingRoot: join(__dirname, '../..'),
};

export default nextConfig;
