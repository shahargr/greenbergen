import { createClient } from "@shared/supabase/server";
import { isMissingFunction, rpc } from "@shared/rpc";
import { timed } from "@shared/perf";
import type { Progress } from "@shared/progress";
export type { Progress };

export { TARGET_WINDOWS, targetWindowLabel, type BookingState, type TargetWindow } from "@/lib/plan";
import type { BookingState, TargetWindow } from "@/lib/plan";

export type Home = {
  project_id: string; address: string | null; name: string | null; town: string | null; created_at: string;
  // The number for the property itself - the site contact, the one on the
  // sign. Not the owner's personal number (migration 097).
  phone: string | null;
  facts: Record<string, unknown> | null; live: number; planned: number; done: number;
  // The face of the house: the newest photo filed against the home itself,
  // not against a job under it. Null until someone adds one.
  photo: { file_id: string; path: string } | null;
  // Who else is on the property, and how many invitations are still open.
  // The owner is not in the list - the owner is the one reading it.
  people: { name: string; role: string; status: string }[];
  invited: number;
};
export type HomeQuota = { allowed: number | null; have: number; can_add: boolean } | null;

// WHERE A JOB HONESTLY STANDS (migration 119). Computed in the database from
// the stage AND the evidence for it, so every door tells the same story.
// projects.status is not this: it is "In Progress" on everything not closed.
export type ProgressLabel = { key: string; label: string; detail: string; order: number };

export type BookingSummary = {
  project_id: string; package_code: string; name: string; tile_title: string; illustration: string;
  requires_permit: boolean; instant_book: boolean; address: string | null; home_project_id: string; price_cents: number; config_label: string | null;
  state: BookingState; created_at: string; posted_at: string | null; target_window: TargetWindow | null; reply_by: string | null; accepted_at: string | null;
  closed_at: string | null; done_at: string | null; repost_count: number; offered_count: number; no_taker: boolean;
  // The photo request: how many the package still wants, and the open task
  // that asks for them. A null action_id means there is nothing to nag about.
  photos_needed: number; photos_action_id: string | null;
  share_slug: string | null;
  contractor: { contact_id: string; name: string; person: string; phone: string | null } | null;
  progress: Progress | null; unread: number;
  last_message: { body: string; sent_at: string; mine: boolean; who: string } | null;
  // The PROJECT's status, not the booking's state (migration 116). A booking
  // that closed only means the request stopped going out to the community;
  // the work may well have carried on, and reading the booking's state as the
  // job's was hiding live jobs as "cancelled".
  project_status: string | null;
  progress_label: ProgressLabel | null;
};

// EVERY JOB UNDER THE MEMBER'S HOMES, booked or not (migration 116). The
// booking list only ever knew about jobs that came through the package
// wizard, which on Shahar's own account was four out of ten.
export type ProjectSummary = {
  project_id: string; name: string; address: string | null; status: string; stage: string | null;
  package_code: string | null; home_project_id: string | null; home_name: string | null;
  // How the job is being taken on (migration 195). NULL on a project that
  // predates the choice - most of the old ones - so the badge stays off
  // rather than guessing.
  delivery: "diy" | "hired" | null;
  // False for a job somebody simply started - it has no price, no package
  // and no wizard answers, and the screen should not pretend otherwise.
  has_booking: boolean;
  open_tasks: number; people: number; unread: number;
  cover: string | null; cover_url: string | null; created_at: string;
  progress_label: ProgressLabel | null;
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
      projects: ProjectSummary[];
    };

// The signed-in shell in one call. Signed-in is decided from the session
// cookie's claims (verified locally, no round trip) - the same test the
// proxy and /join use - so two pages can never disagree and bounce a
// member between them. When homeowner_me() cannot be read the member is
// still signed in: `missing` when the functions are not in the database,
// `degraded` for any other failure; screens say so instead of redirecting.
export async function getMe(): Promise<Me> {
  const supabase = await createClient();
  const { data: claimsData } = await timed("me.claims", () => supabase.auth.getClaims());
  const claims = claimsData?.claims as { sub?: string; email?: string; user_metadata?: { full_name?: string } } | undefined;
  if (!claims?.sub) return { signed_in: false };
  const { data, error } = await timed("me.rpc", () => rpc<Me>(supabase, "homeowner_me"));
  if (!error && data && data.signed_in) return data;
  if (error) console.error("homeowner_me:", error.message);
  else console.error("homeowner_me: signed_in false for auth user", claims.sub);
  return {
    signed_in: true, missing: !!error && isMissingFunction(error), degraded: !error || !isMissingFunction(error),
    profile: { app_user_id: claims.sub, full_name: claims.user_metadata?.full_name ?? null, email: claims.email ?? null, home_zip: null, home_town: null, contact_id: null, is_superadmin: false },
    home: null, homes: [], home_quota: null, bookings: [], projects: [],
  };
}
