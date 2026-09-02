import { createClient } from "@/lib/supabase/server";
import { createDeal, updateDeal, markBookingPaid } from "./actions";

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
};

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
  const [{ data: dealRows }, { data: bookingRows }, { data: tradeRows }] = await Promise.all([
    supabase.from("promotions").select("id, title, summary, detail, trade, town, state_cd, price_cents, offer_terms, service_dates, max_signups, status, view_count, click_count, order_count").order("created_at", { ascending: false }),
    supabase.from("promotion_signups").select("id, promotion_id, status, service_date, amount_cents, paid_at, app_users(email, full_name)").order("created_at", { ascending: false }),
    supabase.from("trades").select("trade").order("sort_order"),
  ]);
  const deals = (dealRows ?? []) as unknown as Deal[];
  const bookings = (bookingRows ?? []) as unknown as Booking[];
  const trades = ((tradeRows ?? []) as { trade: string }[]).map((t) => t.trade);

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
                {d.title} <span className="muted small">· {d.status} · {dollars(d.price_cents)}</span>
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
