import path from "node:path";
import type { NextConfig } from "next";

// The homeowner app imports the design system, the Supabase glue and the
// catalogue from apps/shared (tsconfig path @shared/*). Turbopack must know
// the repo root so files outside this folder are in bounds; the same root
// keeps output tracing right on Vercel, where Root Directory is apps/homeowner.
const repoRoot = path.join(__dirname, "..", "..");

const nextConfig: NextConfig = {
  // This app answers under ONE path of ONE host - greenbergen.vercel.app/home -
  // proxied there by the portal's rewrites (see apps/shared/src/site.ts for
  // why: a session cookie cannot cross vercel.app hosts). next/link,
  // redirect() and router.push() add the prefix themselves; raw URLs read it
  // from NEXT_PUBLIC_BASE_PATH.
  basePath: "/home",
  // Which door this deployment IS, baked in at build time so the shared
  // Wordmark can name the app under the logo on every screen without each
  // call site saying so - and without a Vercel setting anyone can forget.
  env: { NEXT_PUBLIC_APP_DOOR: "homeowner", NEXT_PUBLIC_BASE_PATH: "/home" },
  // An old bookmark to this project's own host lands on its root, which the
  // basePath no longer serves. Send it under the path rather than 404.
  async redirects() {
    return [{ source: "/", destination: "/home", basePath: false, permanent: false }];
  },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
