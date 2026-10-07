import path from 'node:path';
import type { NextConfig } from 'next';

// next.config.ts is loaded as native ESM (package "type": "module"), so use import.meta.dirname.
const here = import.meta.dirname;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared engine is TypeScript source without a build step.
  transpilePackages: ['@aml/engine'],
  turbopack: {
    // Monorepo root so workspace packages (packages/engine) and hoisted deps resolve.
    root: path.join(here, '../..'),
  },
  poweredByHeader: false,
};

export default nextConfig;
