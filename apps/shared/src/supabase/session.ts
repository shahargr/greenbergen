import type { SupabaseClient } from "@supabase/supabase-js";
import { timed } from "../perf";

// Who is signed in, for pages that only need a yes or no (a "Sign in" link,
// a redirect). getClaims verifies the session cookie in process when the
// project signs asymmetrically; getUser always costs a round trip to the
// auth server, so nothing here calls it.
export async function sessionClaims(supabase: SupabaseClient, label = "auth.claims") {
  const { data } = await timed(label, () => supabase.auth.getClaims());
  const claims = (data?.claims ?? null) as { sub?: string; email?: string; user_metadata?: { full_name?: string } } | null;
  return claims?.sub ? claims : null;
}

export const isSignedIn = async (supabase: SupabaseClient, label?: string) => !!(await sessionClaims(supabase, label));
