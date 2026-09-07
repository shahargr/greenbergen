import { createClient } from "@shared/supabase/server";
import { isMissingFunction, rpc } from "@shared/rpc";
import type { Progress } from "@shared/progress";
export type { Progress };

export { TARGET_WINDOWS, targetWindowLabel, type BookingState, type TargetWindow } from "@/lib/plan";
import type { BookingState, TargetWindow } from "@/lib/plan";

export type Home = {
  project_id: string; address: string | null; name: string | null; town: string | null; created_at: string;
  facts: Record<string, unknown> | null; live: number; planned: number; done: number;
};
export type HomeQuota = { allowed: number | null; have: number; can_add: boolean } | null;

export type BookingSummary = {
  project_id: string; package_code: string; name: string; tile_title: string; illustration: string;
  requires_permit: boolean; instant_book: boolean; address: string | null; home_project_id: string; price_cents: number; config_label: string | null;
  state: BookingState; created_at: string; posted_at: string | null; target_window: TargetWindow | null; reply_by: string | null; accepted_at: string | null;
  closed_at: string | null; done_at: string | null; repost_count: number; offered_count: number; no_taker: boolean;
  share_slug: string | null;
  contractor: { contact_id: string; name: string; person: string; phone: string | null } | null;
  progress: Progress | null; unread: number;
  last_message: { body: string; sent_at: string; mine: boolean; who: string } | null;
};

export type Me =
  | { signed_in: false; missing?: boolean; email?: string | null }
  | {
      signed_in: true; missing?: boolean; degraded?: boolean;
      profile: { app_user_id: string; full_name: string | null; email: string | null; home_zip: string | null; home_town: string | null; contact_id: string | null; is_superadmin: boolean };
      home: { project_id: string; address: string | null; name: string | null; facts: Record<string, unknown> | null } | null;
      homes: Home[];
      home_quota: HomeQuota;
      bookings: BookingSummary[];
    };

// The signed-in shell in one call. Signed-in is decided from the session
// cookie's claims (verified locally, no round trip) - the same test the
// proxy and /join use - so two pages can never disagree and bounce a
// member between them. When homeowner_me() cannot be read the member is
// still signed in: `missing` when the functions are not in the database,
// `degraded` for any other failure; screens say so instead of redirecting.
export async function getMe(): Promise<Me> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as { sub?: string; email?: string; user_metadata?: { full_name?: string } } | undefined;
  if (!claims?.sub) return { signed_in: false };
  const { data, error } = await rpc<Me>(supabase, "homeowner_me");
  if (!error && data && data.signed_in) return data;
  if (error) console.error("homeowner_me:", error.message);
  else console.error("homeowner_me: signed_in false for auth user", claims.sub);
  return {
    signed_in: true, missing: !!error && isMissingFunction(error), degraded: !error || !isMissingFunction(error),
    profile: { app_user_id: claims.sub, full_name: claims.user_metadata?.full_name ?? null, email: claims.email ?? null, home_zip: null, home_town: null, contact_id: null, is_superadmin: false },
    home: null, homes: [], home_quota: null, bookings: [],
  };
}
