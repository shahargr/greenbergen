import type { NextConfig } from "next";

// The homeowner app. Photos and voice notes go straight from the browser to
// Supabase Storage, so server actions stay small; the limit is raised only
// for the odd form that carries a file.
const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
