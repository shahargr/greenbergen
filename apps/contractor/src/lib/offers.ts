import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { timed } from "@shared/perf";

// The offer feed, and one offer out of it.
//
// homeowner_offers() has existed since the homeowner app shipped and is
// already town-only - it never returns an address, which is the address rule
// (migration 008) enforced where it belongs rather than in a component that
// might forget. Everything on this screen comes out of that one read.
export type Offer = {
  project_id: string; bid_id: string; package: string; trade: string | null;
  price_cents: number; config_label: string | null; town: string | null;
  posted_at: string | null; reply_by: string | null;
  scope: string[] | null; photos: number; status: string;
};

export async function loadOffers(): Promise<Offer[]> {
  const supabase = await createClient();
  const { data } = await timed("offers", () => rpc<Offer[]>(supabase, "homeowner_offers"));
  return Array.isArray(data) ? data : [];
}

// One offer, by the job it is for. No p_project overload exists and none is
// wanted: a contractor has a handful of open offers, not a page of them, so
// filtering the feed is cheaper than a second function to keep in step.
export async function loadOffer(projectId: string): Promise<Offer | null> {
  const all = await loadOffers();
  return all.find((o) => o.project_id === projectId) ?? null;
}

// The set of jobs this person has a live offer on. The inbox uses it to know
// that a message is an offer - a bid invitation and a note from a neighbour
// need different verbs, and guessing from the body text would be a lie
// waiting to happen.
export async function openOfferIds(): Promise<Set<string>> {
  return new Set((await loadOffers()).map((o) => o.project_id));
}
