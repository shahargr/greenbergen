import { type EmailOtpType } from "@supabase/supabase-js";
import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@shared/supabase/server";
// Route handlers get no basePath for free: new URL("/x", request.url) drops
// it and the redirect would leave the app. withBase puts it back.
import { withBase } from "@shared/site";

// The emailed link lands here (PKCE ?code= or token_hash + type), then on
// to `next` - /welcome for a new member, /project for a returning one.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/project";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/project";

  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(withBase(next), request.url));
  }
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(withBase(next), request.url));
  }
  return NextResponse.redirect(new URL(withBase("/login?error=link"), request.url));
}
