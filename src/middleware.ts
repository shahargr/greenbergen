import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Everything except static assets and images - and except the three
    // paths proxied to the other apps (/home, /pro, /build; next.config.ts).
    // Each of those runs its own session proxy; if this one ran first it
    // would bounce a signed-out visitor to THIS app's /login instead of
    // letting the homeowner app show its public catalogue.
    "/((?!_next/static|_next/image|favicon.ico|home(?:/|$)|pro(?:/|$)|build(?:/|$)|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
