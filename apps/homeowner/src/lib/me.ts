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
      signed_in: true; missing?: boolean;
      profile: { app_user_id: string; full_name: string | null; email: string | null; home_zip: string | null; home_town: string | null; contact_id: string | null; is_superadmin: boolean };
      home: { project_id: string; address: string | null; name: string | null; facts: Record<string, unknown> | null } | null;
      homes: Home[];
      home_quota: HomeQuota;
      bookings: BookingSummary[];
    };

// The signed-in shell in one call. When the homeowner functions are not in
// the database yet (db/ not applied), fall back to the auth user so the app
// still renders and says what is missing.
export async function getMe(): Promise<Me> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { signed_in: false };
  const { data, error } = await rpc<Me>(supabase, "homeowner_me");
  if (!error && data && data.signed_in) return data;
  if (error && isMissingFunction(error)) {
    return {
      signed_in: true, missing: true,
      profile: { app_user_id: auth.user.id, full_name: (auth.user.user_metadata?.full_name as string) ?? null, email: auth.user.email ?? null, home_zip: null, home_town: null, contact_id: null, is_superadmin: false },
      home: null, homes: [], home_quota: null, bookings: [],
    };
  }
  if (error) console.error("homeowner_me:", error.message);
  return { signed_in: false, email: auth.user.email ?? null };
}
