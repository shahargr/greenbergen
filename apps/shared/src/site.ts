// WHERE THE APPS LIVE: one host, four paths.
//
//   greenbergen.vercel.app/        the portal (admin)
//   greenbergen.vercel.app/home    the homeowner app
//   greenbergen.vercel.app/pro     the contractor app
//   greenbergen.vercel.app/build   the builder app
//
// WHY. They used to be four hosts, and vercel.app is on the public-suffix
// list, so a session cookie set on one could never be read by another. A
// person who signed in on the portal and picked "Homeowner" arrived at the
// homeowner app as a stranger and was asked to join. "One login, four doors"
// was true in Supabase and false in the browser. One host fixes it: the
// Supabase cookie (sb-<ref>-auth-token, path=/) is the same cookie on every
// path, so signing in anywhere signs you in everywhere.
//
// HOW. Each app is still its own Vercel project; each is built with a
// basePath (/home, /pro, /build - next.config.ts) and the portal proxies those
// paths to it (rewrites in the root next.config.ts). Nothing moved, nothing
// merged - the portal is a front door, and the apps answer behind it.
//
// BASE_PATH is baked in at build time so client code that builds an absolute
// URL by hand (OAuth redirectTo, fetch to /api, a share link) can prefix it.
// next/link, redirect() and router.push() prefix it on their own; raw URLs do
// not, and that is every place this constant appears.
export const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_ORIGIN?.trim() || "https://greenbergen.vercel.app").replace(/\/$/, "");
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

// A path inside this app, made absolute for the places that need it.
export const withBase = (path: string) => `${BASE_PATH}${path}`;
export const appUrl = (path = "") => `${SITE_ORIGIN}${BASE_PATH}${path}`;
