import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pas d'en-tête « X-Powered-By : Next.js » (inutile d'annoncer la pile).
  poweredByHeader: false,
  experimental: {
    // Justificatifs d'achat (photo réduite ou PDF) : 5,5 Mo + le reste du formulaire.
    serverActions: { bodySizeLimit: "6mb" },
  },
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
