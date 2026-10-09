import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pas d'en-tête « X-Powered-By : Next.js » (inutile d'annoncer la pile).
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
