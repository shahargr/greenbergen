import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@shared/supabase/server";
import { isMissingFunction, rpc } from "@shared/rpc";
import { timed } from "@shared/perf";
import type { Package } from "@shared/catalogue";
import type { BookingState, Progress, TargetWindow } from "@/lib/me";

export type Stage = {
  id: string; name: string; sequence_no: number | null; amount_cents: number; percent: number | null; status: string;
  settlement_status: string; paid_at: string | null; approved_at: string | null; trigger: string | null;
  evidence: { file_id: string; path: string; kind: string }[];
};
export type JobFile = { id: string; path: string; bucket: string; kind: string; mime: string | null; caption: string | null; created_at: string; by_me: boolean; by: string | null; role: string | null };
export type Message = {
  id: string; body: string; sent_at: string; mine: boolean; system: boolean; who: string; read_at: string | null; file_id: string | null;
  file: { path: string; kind: string; mime: string | null } | null;
};
export type Contractor = {
  contact_id: string; name: string; person: string; phone: string | null; email: string | null; license: string | null; insured: boolean;
  insurance: { coverage: string | null; limit: number | null; expires: string | null } | null;
  rating: { score: number; responses: number; rehire_pct: number | null; provisional: boolean } | null; jobs: number;
};
// The photo request on a job: what the package asks for, which slots are
// filled, and the open task that carries the ask (null once it is closed).
export type PhotoRequestState = {
  outstanding: number; required: number; have: number; action_id: string | null;
  slots: { key: string; label: string; hint: string | null; file_id: string | null }[];
};
export type Booking = {
  project_id: string; home_project_id: string; package_code: string; package: Package | null; address: string | null; unit: string | null;
  project_status: string; price_cents: number; base_price_cents: number; selections: Record<string, string>; config_label: string | null;
  facts: Record<string, unknown> | null; budget_band: string | null; note: string | null;
  state: BookingState; created_at: string; posted_at: string | null; target_window: TargetWindow | null; live_price_cents: number | null;
  reply_by: string | null; repost_count: number; offered_count: number;
  accepted_at: string | null; closed_at: string | null; close_reason: string | null; done_at: string | null; no_taker: boolean;
  photos: PhotoRequestState | null;
  is_owner: boolean; my_contact_id: string | null;
  share: { slug: string | null; shared_at: string | null; quote: string | null; hide_address: boolean; after_file_id: string | null };
  owner: { contact_id: string | null; name: string | null } | null;
  contractor: Contractor | null; progress: Progress; stages: Stage[]; scope: { item: string; detail: string | null; kind: "work" | "assurance" }[];
  files: JobFile[]; messages: Message[]; unread: number;
  open_tasks: { id: string; action: string; status: string; kind: "payment_confirmation" | "milestone" | "photos" | "other"; pending_reason: string | null; created_at: string }[];
};

export async function getBooking(projectId: string): Promise<{ booking: Booking | null; missing: boolean; supabase: SupabaseClient }> {
  const supabase = await createClient();
  const { data, error } = await timed("booking.rpc", () => rpc<Booking>(supabase, "homeowner_booking", { p_project: projectId }));
  if (error) {
    if (isMissingFunction(error)) return { booking: null, missing: true, supabase };
    console.error("homeowner_booking:", error.message);
    return { booking: null, missing: false, supabase };
  }
  return { booking: data ?? null, missing: false, supabase };
}

// Photos in the private bucket are shown by signed URL, one hour.
export async function signedUrls(supabase: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data } = await timed("signedUrls", () => supabase.storage.from("project-media").createSignedUrls(unique, 3600));
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}

export const bookingHeadline = (b: Booking) => b.package?.name ?? b.package_code;
