import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { FootBar } from "@/components/FootBar";
import { createClient } from "@/lib/supabase/server";
import { bookDeal, cancelBooking } from "./actions";

export const dynamic = "force-dynamic";

type DealDate = { date: string; left: number };
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
  slots_per_day: number | null;
  dates: DealDate[];
};

type MyBooking = {
  promotion_id: string;
  status: string;
  service_date: string | null;
  amount_cents: number | null;
};

const dollars = (cents: number | null) =>
  cents == null ? null : `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

const prettyDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

// Public deals landing: one pro, one day, one town - neighbors book slots
// at a group price. Booking needs an account; browsing does not.
export default async function DealsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; booked?: string }>;
}) {
  const { error, booked } = await searchParams;
  const supabase = await createClient();
  const [{ data: dealsData }, { data: auth }, { data: bannerData }] = await Promise.all([
    supabase.rpc("public_deals"),
    supabase.auth.getUser(),
    supabase.rpc("public_banner"),
  ]);
  const deals = ((dealsData ?? []) as Deal[]);
  const signedIn = !!auth.user;
  const banner = (bannerData ?? null) as { text: string; url: string | null } | null;

  // Every render of the landing counts one view per listed deal.
  if (deals.length) {
    await supabase.rpc("deal_track", { p_kind: "view", p_ids: deals.map((d) => d.id) });
  }

  let mine = new Map<string, MyBooking>();
  if (signedIn && deals.length) {
    const { data: rows } = await supabase
      .from("promotion_signups")
      .select("promotion_id, status, service_date, amount_cents")
      .in("promotion_id", deals.map((d) => d.id));
    mine = new Map(((rows ?? []) as MyBooking[]).map((b) => [b.promotion_id, b]));
  }

  return (
    <div className="page">
      <SiteHeader />
      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 680, paddingBottom: 64 }}>
        <span className="kicker">Deals</span>
        <h1 style={{ fontSize: 28, margin: "6px 0 4px" }}>Neighborhood deals</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          A great pro, booked for one day in one town — neighbors share the
          trip charge, everyone gets the group price. Pick a day, book your slot.
        </p>

        {banner && (
          <p className="banner" style={{ background: "#1f6b45" }}>
            {banner.text}
            {banner.url && <>{" "}<a href={banner.url} style={{ color: "#fff", textDecoration: "underline" }}>Learn more →</a></>}
          </p>
        )}

        {booked && (
          <p className="banner" style={{ background: "#2f6b4f" }}>
            Booked for {prettyDate(booked)} ✓ — your spot is held. Online payment
            is coming; we&apos;ll send a payment link before the visit.
          </p>
        )}
        {error && <p className="error small">{error}</p>}

        {deals.length === 0 && (
          <div className="card">
            <p className="muted" style={{ margin: 0 }}>
              No open deals right now. Deals appear when enough neighbors want
              the same work — <Link href="/join">join</Link> and tell us what
              you need.
            </p>
          </div>
        )}

        <div style={{ display: "grid", gap: 14 }}>
          {deals.map((d) => {
            const my = mine.get(d.id);
            const hasBooking = my && ["reserved", "paid", "confirmed"].includes(my.status);
            const bookable = d.dates.filter((x) => x.left > 0);
            return (
              <div key={d.id} className="card" style={{ padding: "16px 18px", display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 17 }}>{d.title}</strong>
                  {d.price_cents != null && (
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--brand, #1f6b45)" }}>
                      {dollars(d.price_cents)}
                    </span>
                  )}
                </div>
                <div className="muted small" style={{ marginTop: -4 }}>
                  {[d.trade, d.town && `${d.town}, ${d.state_cd}`].filter(Boolean).join(" · ")}
                </div>
                {d.summary && <p className="small" style={{ margin: 0 }}>{d.summary}</p>}
                {d.detail && <p className="muted small" style={{ margin: 0 }}>{d.detail}</p>}
                {d.offer_terms && <p className="muted small" style={{ margin: 0 }}>{d.offer_terms}</p>}

                {hasBooking ? (
                  <div style={{ display: "grid", gap: 6 }}>
                    <p className="small" style={{ margin: 0 }}>
                      ✓ Your slot: <strong>{my!.service_date && prettyDate(my!.service_date)}</strong>
                      {my!.amount_cents != null && <> · {dollars(my!.amount_cents)} {my!.status === "paid" ? "paid" : "due"}</>}
                    </p>
                    {my!.status !== "paid" && (
                      <form action={cancelBooking}>
                        <input type="hidden" name="deal" value={d.id} />
                        <button className="btn ghost small">Cancel booking</button>
                      </form>
                    )}
                  </div>
                ) : bookable.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>Fully booked — check back for the next date.</p>
                ) : signedIn ? (
                  <form action={bookDeal} className="btn-row" style={{ alignItems: "center" }}>
                    <input type="hidden" name="deal" value={d.id} />
                    <select name="date" className="input" required defaultValue={bookable[0].date} style={{ maxWidth: 230 }}>
                      {bookable.map((x) => (
                        <option key={x.date} value={x.date}>
                          {prettyDate(x.date)}{d.slots_per_day ? ` — ${x.left} slot${x.left > 1 ? "s" : ""} left` : ""}
                        </option>
                      ))}
                    </select>
                    <button className="btn">{d.price_cents != null ? `Book · ${dollars(d.price_cents)}` : "Book"}</button>
                  </form>
                ) : (
                  <p className="small" style={{ margin: 0 }}>
                    <Link className="btn" href={`/login?next=${encodeURIComponent("/deals")}`}>Sign in to book</Link>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </main>
      <FootBar />
    </div>
  );
}
