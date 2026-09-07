import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@shared/supabase/server";
import { sessionClaims } from "@shared/supabase/session";
import { townForZip } from "@shared/bergen";

// Where a Google sign-up lands after /auth/confirm: the session exists and
// the signup trigger has made the profile row; this adds the ZIP, town and
// referral exactly as the code path does, then continues to `next`.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = (searchParams.get("name") ?? "").trim();
  const zip = (searchParams.get("zip") ?? "").trim();
  const ref = searchParams.get("ref");
  const rawNext = searchParams.get("next") ?? "/welcome";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/welcome";
  const supabase = await createClient();
  const claims = await sessionClaims(supabase);
  if (!claims) return NextResponse.redirect(new URL("/login?error=link", request.url));
  if (/^\d{5}$/.test(zip)) {
    const { error } = await supabase.rpc("homeowner_register", {
      p_full_name: name || claims.user_metadata?.full_name || null,
      p_zip: zip, p_town: townForZip(zip), p_ref: ref && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null,
    });
    if (error) console.warn("homeowner_register:", error.message);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
