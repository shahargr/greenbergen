// Publishable by design (the anon key ships in every browser bundle; RLS is
// the boundary). Env vars override these defaults when set.
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://oznqiwldgjrykadqsriv.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bnFpd2xkZ2pyeWthZHFzcml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMjkxNDgsImV4cCI6MjEwMTgwNTE0OH0.FxHIbx_8JBdcCocH3UcX4aaFoRMXKQ3U2lsOXec8fb4",
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  // Public routes: login, auth callback, and (future) public pages
  const isPublic =
    path === "/" ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/p/") ||
    path.startsWith("/vision") ||
    path.startsWith("/help") ||
    path.startsWith("/join") ||
    path.startsWith("/vendor/complete");

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }

  return response;
}
