import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Where an invitation accepted with Google lands, after /auth/confirm has
// turned the OAuth code into a session.
//
// The email-code path redeems from the form, right after verifyOtp. Google
// leaves the page entirely, so the token rides in the query and is redeemed
// here instead - the same call at the same point in the story: signed in
// first, invitation applied second. redeem_invitation needs a session, which
// is why it cannot happen before the hop, and it is idempotent (one
// invitation_redemptions row per person) so a reload cannot double-apply it.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const invite = searchParams.get("invite");
  const rawNext = searchParams.get("next") ?? "/after-login";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/after-login";

  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    return NextResponse.redirect(new URL("/login?error=link", request.url));
  }

  // A spent or revoked token must not strand someone who is now signed in:
  // they land in the app either way, and the invitation simply did not apply.
  if (invite && /^[0-9a-f-]{36}$/i.test(invite)) {
    const { error } = await supabase.rpc("redeem_invitation", { p_token: invite });
    if (error) console.warn("redeem_invitation:", error.message);
  }
  return NextResponse.redirect(new URL(next, request.url));
}
