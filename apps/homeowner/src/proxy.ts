import { type NextRequest } from "next/server";
import { DEFAULT_PUBLIC, updateSession } from "@shared/supabase/proxy";

// Next 16: middleware is called proxy. Same job - session refresh and the
// signed-out redirect - on everything but static assets.
//
// What a stranger may open here, on top of the shared list: Bob (/ask - the
// pitch works signed out), the address check the wizard calls before anyone
// has joined, and the home screen itself, which renders its own "log in"
// card after the packages (project/page.tsx). The home screen is an EXACT
// match, not a prefix: /project/<id> and /projects redirect a stranger to
// /login themselves, but a job's folder, timeline or share screen would only
// 404 at them, and the proxy's redirect is the better answer there.
const PUBLIC = [...DEFAULT_PUBLIC, "/ask", "/api/geocode"];

export async function proxy(request: NextRequest) {
  const publicPrefixes = request.nextUrl.pathname === "/project" ? [...PUBLIC, "/project"] : PUBLIC;
  return await updateSession(request, publicPrefixes);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)"],
};
