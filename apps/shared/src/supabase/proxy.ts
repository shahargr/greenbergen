import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./keys";
import { stopwatch } from "../perf";

// Refreshes the Supabase session cookie on every request and sends a
// signed-out visitor to /login for anything that is not public.
//
// What counts as public differs per app, so each one passes its own list:
// the homeowner app lets a stranger browse the whole catalogue before
// joining, the contractor app does not have one to browse. The landing
// page ("/") is public everywhere.
const DEFAULT_PUBLIC = ["/login", "/auth", "/join", "/packages", "/services", "/s/", "/welcome"];

export async function updateSession(request: NextRequest, publicPrefixes: string[] = DEFAULT_PUBLIC) {
  const w = stopwatch(`proxy ${request.nextUrl.pathname}`);
  request.headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  let response = NextResponse.next({ request });

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getClaims verifies the JWT locally and still refreshes an expired session.
  const { data } = await w.step("auth", () => supabase.auth.getClaims());
  const user = data?.claims ?? null;

  const path = request.nextUrl.pathname;
  const isPublic = path === "/" || publicPrefixes.some((p) => path.startsWith(p));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    w.done();
    return NextResponse.redirect(url);
  }
  w.done();
  response.headers.set("Server-Timing", w.header());
  return response;
}
