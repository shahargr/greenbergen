import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Receipt photos and voice/video notes ride through server actions;
      // the 1MB default rejected any real photo and left forms stuck on
      // "Saving...".
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
