import { join } from 'node:path';
import type { NextConfig } from 'next';

const dashboardDevPort = process.env.FLOWPR_DASHBOARD_PORT ?? process.env.PORT;
const dashboardDevDistDir = process.env.NODE_ENV === 'development'
  ? dashboardDevPort
    ? `.next-${dashboardDevPort}`
    : '.next-dev'
  : undefined;

const nextConfig: NextConfig = {
  transpilePackages: ['@flowpr/schemas', '@flowpr/tools'],
  // Keep dev output isolated from production builds and parallel dashboard servers.
  ...(dashboardDevDistDir ? { distDir: dashboardDevDistDir } : {}),
  outputFileTracingRoot: join(__dirname, '../..'),
};

export default nextConfig;
