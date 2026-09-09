import type { NextConfig } from "next";

// ONE HOST, FOUR PATHS. The three consumer apps are separate Vercel projects
// with their own deployments; this portal is the front door and proxies a
// path to each of them:
//
//   /home  -> greenbergen-homeowner   (built with basePath /home)
//   /pro   -> greenbergen-contractor  (basePath /pro)
//   /build -> greenbergen-builder     (basePath /build)
//
// WHY. They used to be reached on their own hosts, and vercel.app is on the
// public-suffix list, so a session cookie set on one host could never be read
// by another: a person who signed in here and picked "Homeowner" arrived
// there as a stranger. Behind one host the Supabase cookie is one cookie, and
// signing in anywhere signs you in everywhere. See apps/shared/src/site.ts.
//
// ZONE_* lets a destination move (a preview, a new project) without a code
// change; the production URLs are the fallback so nothing breaks if unset.
const zone = (env: string | undefined, fallback: string) => (env?.trim() || fallback).replace(/\/$/, "");
const ZONES: Record<string, string> = {
  home: zone(process.env.ZONE_HOMEOWNER, "https://greenbergen-homeowner.vercel.app"),
  pro: zone(process.env.ZONE_CONTRACTOR, "https://greenbergen-contractor.vercel.app"),
  build: zone(process.env.ZONE_BUILDER, "https://greenbergen-builder.vercel.app"),
};

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Receipt photos and voice/video notes ride through server actions;
      // the 1MB default rejected any real photo and left forms stuck on
      // "Saving...".
      bodySizeLimit: "50mb",
    },
  },
  async rewrites() {
    // beforeFiles: these paths win over anything this app might grow later,
    // and over its public/ folder. Each app answers under its basePath, so
    // the path is passed through unchanged - /home/x goes to .../home/x.
    return {
      beforeFiles: Object.entries(ZONES).flatMap(([path, origin]) => [
        { source: `/${path}`, destination: `${origin}/${path}` },
        { source: `/${path}/:rest*`, destination: `${origin}/${path}/:rest*` },
      ]),
    };
  },
};

export default nextConfig;
