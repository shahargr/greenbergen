import { type NextRequest } from "next/server";
import { updateSession } from "@shared/supabase/proxy";

// Next 16: middleware is called proxy. Same job - session refresh and the
// signed-out redirect - on everything but static assets.
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)"],
};
