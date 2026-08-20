import type { NextConfig } from "next";

// GITHUB_PAGES=true builds a static export for GitHub Pages
// (the /api/generate route is removed in that build; the client
// silently falls back to bundled scenarios — by design).
const isPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  ...(isPages
    ? {
        output: "export" as const,
        basePath: "/hackathon-project",
        images: { unoptimized: true },
      }
    : {}),
};

export default nextConfig;
