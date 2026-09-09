import path from "node:path";
import type { NextConfig } from "next";

// The contractor app imports the design system, the Supabase glue and the
// catalogue from apps/shared (tsconfig path @shared/*). Turbopack must know
// the repo root so files outside this folder are in bounds; the same root
// keeps output tracing right on Vercel, where Root Directory is apps/contractor.
const repoRoot = path.join(__dirname, "..", "..");

const nextConfig: NextConfig = {
  // Which door this deployment IS. Baked in at build time so the shared
  // Wordmark can name the app under the logo on every screen without each
  // call site saying so - and without a Vercel setting anyone can forget.
  env: { NEXT_PUBLIC_APP_DOOR: "contractor" },
  turbopack: { root: repoRoot },
  outputFileTracingRoot: repoRoot,
  experimental: {
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
