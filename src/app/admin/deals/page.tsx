import { createClient } from "@/lib/supabase/server";
import { createDeal, updateDeal, markBookingPaid, lockCluster } from "./actions";

export const dynamic = "force-dynamic";

type Deal = {
  id: string;
  title: string;
  summary: string | null;
  detail: string | null;
  trade: string | null;
  town: string | null;
  state_cd: string;
  price_cents: number | null;
  offer_terms: string | null;
  service_dates: string[];
  max_signups: number | null;
  status: string;
  view_count: number;
  click_count: number;
  order_count: number;
  pricing_mode: "flat" | "cluster";
  radius_miles: number;
  window_days: number;
  tiers?: Tier[];
};
type Tier = { id: string; min_houses: number; price_cents: number; label: string | null };
type Cluster = { id: string; promotion_id: string; status: string; tier_id: string | null; street_key: string | null; scheduled_start: string | null; created_at: string };

type Booking = {
  id: string;
  promotion_id: string;
  status: string;
  service_date: string | null;
  amount_cents: number | null;
  paid_at: string | null;
  app_users: { email: string; full_name: string | null } | null;
};

const STATUSES = ["draft", "open", "closed", "cancelled", "fulfilled"];
const dollars = (c: number | null) => (c == null ? "—" : `$${(c / 100).toLocaleString()}`);

function DealForm({ deal, trades }: { deal?: Deal; trades: string[] }) {
  const action = deal ? updateDeal.bind(null, deal.id) : createDeal;
  return (
    <form action={action} style={{ display: "grid", gap: 10 }}>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Title</label>
          <input name="title" className="input" required defaultValue={deal?.title ?? ""} placeholder="Plumber day in Tenafly" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Trade</label>
          <select name="trade" className="input" defaultValue={deal?.trade ?? ""}>
            <option value="">—</option>
            {trades.map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Summary — one line shown on the deal card</label>
        <input name="summary" className="input" defaultValue={deal?.summary ?? ""} placeholder="Up to 2 hours of plumbing work, group rate" />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Description</label>
        <textarea name="detail" className="input" rows={3} defaultValue={deal?.detail ?? ""} />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Town</label>
          <input name="town" className="input" defaultValue={deal?.town ?? ""} placeholder="Tenafly" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>State</label>
          <input name="state" className="input" defaultValue={deal?.state_cd ?? "NJ"} maxLength={2} />
        </div>
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Price (per booking, $)</label>
          <input name="price" className="input" inputMode="decimal" defaultValue={deal?.price_cents != null ? String(deal.price_cents / 100) : ""} placeholder="249" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Slots per day</label>
          <input name="slots" className="input" inputMode="numeric" defaultValue={deal?.max_signups != null ? String(deal.max_signups) : ""} placeholder="5" />
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Service dates — YYYY-MM-DD, comma separated</label>
        <input name="dates" className="input" defaultValue={(deal?.service_dates ?? []).join(", ")} placeholder="2026-09-20, 2026-10-18" />
      </div>
      {/* Clustered pricing: the contractual ladder, proximity and window. */}
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Pricing</label>
          <select name="pricing_mode" className="input" defaultValue={deal?.pricing_mode ?? "flat"}>
            <option value="flat">Flat — one price per booking</option>
            <option value="cluster">Clustered — price drops as nearby houses book back-to-back</option>
          </select>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Cluster radius (miles) · run window (days)</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input name="radius" className="input" inputMode="decimal" defaultValue={String(deal?.radius_miles ?? 0.5)} style={{ maxWidth: 110 }} />
            <input name="window_days" className="input" inputMode="numeric" defaultValue={String(deal?.window_days ?? 3)} style={{ maxWidth: 110 }} />
          </div>
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label>Ladder — one tier per line: houses, price per house, label (clustered deals)</label>
        <textarea name="ladder" className="input" rows={4}
          defaultValue={(deal?.tiers ?? []).map((t) => `${t.min_houses}, ${(t.price_cents / 100).toFixed(0)}${t.label ? `, ${t.label}` : ""}`).join("\n")}
          placeholder={"1, 249, list\n2, 219, back-to-back\n4, 189, street run"} />
        <p className="muted small" style={{ margin: "4px 0 0" }}>
          Agreed with the vendor up front: two identical jobs on neighbouring houses, one trip. Each house pays the tier its cluster reaches — never more than list.
        </p>
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Terms (optional)</label>
          <input name="terms" className="input" defaultValue={deal?.offer_terms ?? ""} placeholder="Parts billed separately" />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Status</label>
          <select name="status" className="input" defaultValue={deal?.status ?? "draft"}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
      </div>
      <div>
        <button className="btn">{deal ? "Save deal" : "Create deal"}</button>
      </div>
    </form>
  );
}

export default async function AdminDealsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const [{ data: dealRows }, { data: bookingRows }, { data: tradeRows }, { data: tierRows }, { data: clusterRows }] = await Promise.all([
    supabase.from("promotions").select("id, title, summary, detail, trade, town, state_cd, price_cents, offer_terms, service_dates, max_signups, status, view_count, click_count, order_count, pricing_mode, radius_miles, window_days").order("created_at", { ascending: false }),
    supabase.from("promotion_signups").select("id, promotion_id, status, service_date, amount_cents, paid_at, address, window_start, window_end, cluster_id, app_users(email, full_name)").order("created_at", { ascending: false }),
    supabase.from("trades").select("trade").order("sort_order"),
    supabase.from("promotion_tiers").select("id, promotion_id, min_houses, price_cents, label").order("min_houses"),
    supabase.from("promotion_clusters").select("id, promotion_id, status, tier_id, street_key, scheduled_start, created_at").neq("status", "dissolved").order("created_at"),
  ]);
  const tiersByDeal = new Map<string, Tier[]>();
  for (const t of ((tierRows ?? []) as (Tier & { promotion_id: string })[])) {
    tiersByDeal.set(t.promotion_id, [...(tiersByDeal.get(t.promotion_id) ?? []), t]);
  }
  const deals = ((dealRows ?? []) as unknown as Deal[]).map((d) => ({ ...d, tiers: tiersByDeal.get(d.id) ?? [] }));
  const bookings = (bookingRows ?? []) as unknown as (Booking & { address: string | null; window_start: string | null; window_end: string | null; cluster_id: string | null })[];
  const clusters = (clusterRows ?? []) as Cluster[];
  const trades = ((tradeRows ?? []) as { trade: string }[]).map((t) => t.trade);
  const tierLabel = (t?: Tier | null) => (t ? `${t.label ?? `${t.min_houses}+`} · ${dollars(t.price_cents)}/house` : "no tier yet");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Deals</h1>
      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <h2 className="section-title" style={{ margin: 0 }}>New deal</h2>
        <DealForm trades={trades} />
      </div>

      {deals.map((d) => {
        const dealBookings = bookings.filter((b) => b.promotion_id === d.id);
        const active = dealBookings.filter((b) => ["reserved", "paid", "confirmed"].includes(b.status));
        return (
          <div key={d.id} className="card" style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
              <h2 className="section-title" style={{ margin: 0 }}>
                {d.title} <span className="muted small">· {d.status} · {d.pricing_mode === "cluster" ? `ladder ${(d.tiers ?? []).map((t) => `${t.min_houses}→${dollars(t.price_cents)}`).join(" · ") || "(empty)"}` : dollars(d.price_cents)}</span>
              </h2>
              <span className="muted small">
                {d.view_count} views · {d.click_count} clicks · {d.order_count} orders · {active.length} active booking{active.length === 1 ? "" : "s"}
              </span>
            </div>
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Edit deal</summary>
              <div style={{ marginTop: 10 }}>
                <DealForm deal={d} trades={trades} />
              </div>
            </details>
            {/* Clusters forming on this deal: who is in each run, the tier it
                has reached, and the Lock that commits it to the vendor. */}
            {d.pricing_mode === "cluster" && clusters.filter((c) => c.promotion_id === d.id).map((c) => {
              const members = bookings.filter((b) => b.cluster_id === c.id && b.status !== "withdrawn");
              const tier = (d.tiers ?? []).find((t) => t.id === c.tier_id) ?? null;
              return (
                <div key={c.id} className="small" style={{ display: "grid", gap: 4, padding: "8px 10px", background: c.status === "forming" ? "#f7f8f5" : "#eef5f0", borderRadius: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span>
                      <strong>Run · {c.street_key ?? "nearby"}</strong> · {members.length} house{members.length === 1 ? "" : "s"} · {c.status} · {tierLabel(tier)}
                      {c.scheduled_start && <> · starts {c.scheduled_start}</>}
                    </span>
                    {c.status === "forming" && members.length > 0 && (
                      <form action={lockCluster.bind(null, c.id)}>
                        <button className="btn small">Lock run at {tierLabel(tier)}</button>
                      </form>
                    )}
                  </div>
                  {members.map((m) => (
                    <div key={m.id} className="muted">
                      {m.app_users?.full_name ?? m.app_users?.email ?? "?"} · {m.address ?? "—"} · {m.window_start ?? "?"} → {m.window_end ?? "?"} · {m.status}
                    </div>
                  ))}
                </div>
              );
            })}
            {dealBookings.length > 0 && (
              <div style={{ display: "grid", gap: 6 }}>
                {dealBookings.map((b) => (
                  <div key={b.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <span>
                      <strong>{b.app_users?.full_name ?? b.app_users?.email ?? "?"}</strong>
                      {b.service_date && <> · {b.service_date}</>}
                      <span className="muted"> · {b.status}{b.amount_cents != null && <> · {dollars(b.amount_cents)}</>}</span>
                    </span>
                    {b.status === "reserved" && (
                      <form action={markBookingPaid.bind(null, b.id)}>
                        <button className="btn ghost small">Mark paid</button>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
