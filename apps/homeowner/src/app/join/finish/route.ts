import { type NextRequest } from "next/server";
import { createClient } from "@shared/supabase/server";
import { sessionClaims } from "@shared/supabase/session";
import { townForZip } from "@shared/bergen";
// Route handlers get no basePath for free, and behind the proxy request.url
// is the wrong host; redirectWithin puts the base back and stays on the
// host the browser is on.
import { redirectWithin } from "@shared/redirect";

// Where a Google sign-up lands after /auth/confirm: the session exists and
// the signup trigger has made the profile row; this adds the ZIP, town and
// referral exactly as the code path does, then continues to `next`.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const name = (searchParams.get("name") ?? "").trim();
  const zip = (searchParams.get("zip") ?? "").trim();
  const phone = (searchParams.get("phone") ?? "").trim();
  const ref = searchParams.get("ref");
  const rawNext = searchParams.get("next") ?? "/welcome";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/welcome";
  const supabase = await createClient();
  const claims = await sessionClaims(supabase);
  if (!claims) return redirectWithin("/login?error=link");
  if (/^\d{5}$/.test(zip)) {
    const { error } = await supabase.rpc("homeowner_register", {
      p_full_name: name || claims.user_metadata?.full_name || null,
      p_zip: zip, p_town: townForZip(zip), p_ref: ref && /^[0-9a-f-]{36}$/i.test(ref) ? ref : null,
      p_phone: phone || null,
    });
    if (error) console.warn("homeowner_register:", error.message);
  }
  return redirectWithin(next);
}
