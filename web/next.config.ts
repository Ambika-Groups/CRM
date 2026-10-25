import type { NextConfig } from "next";

// Static export for Netlify (decisions D-36): plain HTML, CSS and JavaScript, no server.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@ag/core"],
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
