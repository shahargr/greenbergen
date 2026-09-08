import { createClient } from "@shared/supabase/server";
import { isMissingFunction, rpc } from "@shared/rpc";
import { timed } from "@shared/perf";

// The contractor shell in one call (contractor_me). Signed-in is decided
// from the session cookie's claims - verified locally, no round trip - the
// same test the proxy uses, so two screens can never disagree and bounce a
// person between them. That bug cost us a day on the homeowner app; it is
// not repeated here.
export type Trade = { trade: string; licence: string | null; needs_docs: boolean; stage: string | null };
export type DocState = { needed: boolean; on_file: boolean };
export type Company = {
  id: string; name: string | null; legal_name: string | null; dba: string | null;
  phone: string | null; email: string | null; website: string | null; address: string | null;
  ein: string | null; license_number: string | null; service_zip: string | null;
  service_radius_miles: number | null;
  rating: { score: number; responses: number; rehire_pct: number | null; provisional: boolean } | null;
};
export type ApprovalStatus = "browsing" | "submitted" | "approved" | "more needed" | "suspended";

export type Me =
  | { signed_in: false; missing?: boolean }
  | {
      signed_in: true; missing?: boolean; degraded?: boolean;
      profile: { app_user_id: string; full_name: string | null; email: string | null; contact_id: string | null; is_superadmin: boolean };
      company: Company | null;
      trades: Trade[];
      documents: {
        licence: DocState; liability: DocState; workers_comp: DocState; w9: DocState;
        expiring: { coverage: string | null; expires: string }[];
      };
      approval: { status: ApprovalStatus; submitted_at: string | null; decided_at: string | null; reason: string | null };
      can_accept: boolean;
      counts: { open_offers: number; live_jobs: number; done_jobs: number };
    };

const EMPTY_DOC: DocState = { needed: true, on_file: false };

export async function getMe(): Promise<Me> {
  const supabase = await createClient();
  const { data: claimsData } = await timed("me.claims", () => supabase.auth.getClaims());
  const claims = claimsData?.claims as { sub?: string; email?: string; user_metadata?: { full_name?: string } } | undefined;
  if (!claims?.sub) return { signed_in: false };

  const { data, error } = await timed("me.rpc", () => rpc<Me>(supabase, "contractor_me"));
  if (!error && data && data.signed_in) return data;
  if (error) console.error("contractor_me:", error.message);

  // Signed in either way. A read that failed is a degraded screen, never a
  // redirect back to the login they just came from.
  return {
    signed_in: true,
    missing: !!error && isMissingFunction(error),
    degraded: !error || !isMissingFunction(error),
    profile: {
      app_user_id: claims.sub, full_name: claims.user_metadata?.full_name ?? null,
      email: claims.email ?? null, contact_id: null, is_superadmin: false,
    },
    company: null, trades: [],
    documents: { licence: { needed: false, on_file: false }, liability: EMPTY_DOC, workers_comp: EMPTY_DOC, w9: EMPTY_DOC, expiring: [] },
    approval: { status: "browsing", submitted_at: null, decided_at: null, reason: null },
    can_accept: false,
    counts: { open_offers: 0, live_jobs: 0, done_jobs: 0 },
  };
}

// What is still missing before this contractor may take work. The order is
// the order the screens ask for them.
export function outstanding(me: Extract<Me, { signed_in: true }>) {
  const out: { key: string; label: string; href: string }[] = [];
  if (!me.company?.name) out.push({ key: "business", label: "Your business", href: "/business" });
  if (me.trades.length === 0) out.push({ key: "trades", label: "The trades you work", href: "/business/trades" });
  if (me.documents.licence.needed && !me.documents.licence.on_file) out.push({ key: "licence", label: "Your trade licence", href: "/business/documents" });
  if (!me.documents.liability.on_file) out.push({ key: "gl", label: "General liability certificate", href: "/business/documents" });
  if (!me.documents.workers_comp.on_file) out.push({ key: "wc", label: "Workers' comp certificate", href: "/business/documents" });
  if (!me.documents.w9.on_file) out.push({ key: "w9", label: "A signed W-9", href: "/business/documents" });
  return out;
}
