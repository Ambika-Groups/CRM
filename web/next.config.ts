import type { NextConfig } from "next";

// Static export for Netlify (decisions D-36): plain HTML, CSS and JavaScript, no server.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@ag/core"],
  reactStrictMode: true,
  poweredByHeader: false,
  // Night-build previews only (AG_SKIP_TYPES=1): files that no page imports yet may be half written. The real build is strict.
  ...(process.env.AG_SKIP_TYPES ? { typescript: { ignoreBuildErrors: true } } : {}),
  // Set only by `npm run build:firebase`, to build beside the demo (web/out) instead of over it.
  ...(process.env.AG_OUT_DIR ? { distDir: process.env.AG_OUT_DIR } : {}),
};

export default config;
