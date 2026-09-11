import { NextResponse } from "next/server";
import { withBase } from "./site";

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
  return new NextResponse(null, { status, headers: { Location: withBase(path) } });
}
