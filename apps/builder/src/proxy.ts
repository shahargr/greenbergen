import { type NextRequest } from "next/server";
import { updateSession } from "@shared/supabase/proxy";

// Next 16: middleware is called proxy. A GC app has nothing to browse
// signed out, so only the sign-in flow and the auth callback are public.
const PUBLIC = ["/login", "/auth"];

export async function proxy(request: NextRequest) {
  return await updateSession(request, PUBLIC);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)"],
};
