import { NextResponse } from "next/server";
import { isHostPath, withBase } from "./site";

// A REDIRECT THAT STAYS ON THE HOST THE BROWSER IS ON.
//
// These apps answer behind the portal's proxy: the browser is on
// greenbergen.vercel.app/home/..., the request that reaches a route handler
// carries this app's own host (greenbergen-homeowner.vercel.app). Building
// the redirect from request.url therefore sent the browser to the zone host
// - where the session cookie the handler had just set (on the portal host)
// does not exist. Shahar, 2026-09-11: signed in with Google, landed on the
// sign-in page again; the second sign-in "worked" only because it set a
// second cookie on the zone host.
//
// A RELATIVE Location is resolved by the browser against the page it is on,
// so it stays on the right host whichever one that is, and cookies set
// through cookies() in the handler ride on this response as on any other.
export function redirectWithin(path: string, status: 303 | 307 = 303) {
  // /after-login is the portal's, at the root of the host these apps are
  // proxied behind - prefixing it with this app's basePath would ask the
  // homeowner app for a route only the portal has (Shahar, 2026-09-13).
  return new NextResponse(null, { status, headers: { Location: isHostPath(path) ? path : withBase(path) } });
}
