import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@shared/supabase/server";

// Where a Google sign-up lands. The email-code path registers from the
// form; Google skips it, so the name, company and phone ride in the query
// and are registered here. contractor_register is idempotent, so a
// returning Google user simply passes through.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; user_metadata?: { full_name?: string; name?: string } } | undefined;
  if (!claims?.sub) return NextResponse.redirect(new URL("/login", request.url));

  const name = searchParams.get("name")?.trim() || claims.user_metadata?.full_name || claims.user_metadata?.name || null;
  await supabase.rpc("contractor_register", {
    p_full_name: name,
    p_company_name: searchParams.get("company")?.trim() || null,
    p_phone: searchParams.get("phone")?.trim() || null,
  });
  return NextResponse.redirect(new URL("/work", request.url));
}
