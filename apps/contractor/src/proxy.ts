import { type NextRequest } from "next/server";
import { updateSession } from "@shared/supabase/proxy";

// Next 16: middleware is called proxy. Same job as in the homeowner app -
// session refresh and the signed-out redirect - but a shorter public list.
// There is no catalogue to browse here: everything a home expert does needs
// a login, so only the landing, the join and sign-in flows and the auth
// callback are open. The board paths (/projects, /tasks, /money) inherit it.
const PUBLIC = ["/login", "/auth", "/join"];

export async function proxy(request: NextRequest) {
  return await updateSession(request, PUBLIC);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff2)$).*)"],
};
