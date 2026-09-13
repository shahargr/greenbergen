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

// WHERE A SIGN-IN LANDS WHEN NOTHING ELSE SAID.
//
// Shahar (2026-09-13): "per settings i was logged as professional, but landed
// on the home owner page. as professional this is not what i was looking to
// see."
//
// He was right and it was never wired. app_users.default_door (migration 076)
// was read in exactly ONE place - the portal's /after-login - and each app's
// own sign-in screen went straight to its own front door instead. So signing
// in at /home/login always landed in the homeowner app, whatever the setting
// said, and landingDoor() sat in doors.ts unused by anybody.
//
// This is that one place, named. It lives on the PORTAL, at the root of the
// host every app is proxied behind, so it is host-absolute: it must never be
// prefixed with an app's basePath, which is what hostPath below is for.
export const AFTER_LOGIN = "/after-login";

// A path that belongs to the HOST rather than to this app. Only the sign-in
// hand-off is one today; keeping the test in one place means the confirm
// routes and the client cannot disagree about it.
export const isHostPath = (path: string) =>
  path === AFTER_LOGIN || path.startsWith(`${AFTER_LOGIN}?`) || path.startsWith(`${AFTER_LOGIN}/`);

// The same place, spelled for next/navigation's redirect(), which prefixes a
// relative path with this app's basePath just as the router does. An absolute
// URL is the only way out of the base from a server component.
export const afterLoginUrl = () => `${SITE_ORIGIN}${AFTER_LOGIN}`;
