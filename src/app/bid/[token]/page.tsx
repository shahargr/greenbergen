import { createClient } from "@/lib/supabase/server";
import { sendPrice } from "./actions";

export const dynamic = "force-dynamic";
// A bid is not a public page: no search engine should hold a copy of somebody's
// scope, and a link that leaks into an index is a link that leaks.
export const metadata = { title: "Your price", robots: { index: false, follow: false } };

// PRICE A JOB WITHOUT AN ACCOUNT.
//
// Shahar (2026-09-17), settling how a price gets in:
//   "Path 1: PM/GC document on his behalf the pricing
//    Path 2: Link is shared with the contractor where he can log his price
//            even without loging into the system"
//
// This is path 2, and it is the only screen in the system with no login, no
// navigation and nothing to explore: the man got a text, he taps it, he sees
// what he is being asked to price, he types a number, he is done. Every extra
// control on this page is a reason for him not to answer.
//
// WHAT HE IS NOT SHOWN, and it is deliberate: the address (migration 008 - the
// town until the work is awarded), the budget, and any other bidder. The
// database enforces all three in bid_by_token; this page could not leak them
// if it tried.
type Item = { scope_item_id: string; item: string; is_required: boolean; included: boolean };
type Said = { amount: number | null; valid_until: string | null; notes: string | null; on: string | null };
type Bid = {
  open: boolean; settled: boolean;
  you: string | null; person: string | null; from: string | null; from_company: string | null;
  job: string | null; town: string | null; trade: string | null;
  reply_by: string | null; scope_summary: string | null;
  terms: { deposit_pct: number | null; retainage_pct: number | null; net_days: number | null;
           workers_comp: boolean | null; coi: boolean | null };
  items: Item[];
  said: Said | null;
};

const day = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default async function BidByLink({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ ok?: string; error?: string; again?: string }>;
}) {
  const { token } = await params;
  const { ok, error, again } = await searchParams;

  const supabase = await createClient();
  const { data } = await supabase.rpc("bid_by_token", { p_token: token });
  const bid = (data ?? null) as Bid | null;

  // A dead link says so plainly and asks for nothing. No sign-in, no
  // "contact support", no form that cannot work.
  if (!bid) {
    return (
      <Shell>
        <h1 style={{ fontSize: 22, margin: "8px 0 6px" }}>This link is no longer live</h1>
        <p className="muted" style={{ margin: 0 }}>
          It may have been replaced by a newer one. Ask whoever sent it for a fresh link.
        </p>
      </Shell>
    );
  }

  const said = bid.said;
  const answered = said?.amount != null;
  const showForm = bid.open && (!answered || again === "1");

  return (
    <Shell>
      {/* WHO IS ASKING, AND FOR WHAT. */}
      <p className="kicker" style={{ margin: 0 }}>{bid.from_company ?? "Green Bergen"}</p>
      <h1 style={{ fontSize: "clamp(21px, 4vw, 27px)", margin: "6px 0 4px", lineHeight: 1.2 }}>
        {bid.from ?? "We"} asked you to price the {(bid.trade ?? "work").toLowerCase()}
      </h1>
      <p className="muted" style={{ margin: "0 0 14px" }}>
        {[bid.job, bid.town].filter(Boolean).join(" · ")}
        {bid.reply_by ? ` · reply by ${day(bid.reply_by)}` : ""}
      </p>

      {error && <p className="error" style={{ margin: "0 0 12px" }}>{error}</p>}
      {ok === "sent" && (
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Got it — thank you.</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Your price is in. You will hear back either way, and nothing is decided until you do.
          </p>
        </div>
      )}
      {ok === "gaps" && (
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <h2 style={{ fontSize: 17, margin: "0 0 4px" }}>Got it — with a note.</h2>
          <p className="muted small" style={{ margin: 0 }}>
            Your price is in, and it does not cover every line that was asked for. That is fine —
            it is recorded as it stands, and the difference is counted when the prices are compared.
          </p>
        </div>
      )}

      {/* WHAT HE ALREADY SAID. Shown whether or not the room is still open,
          because "what did I quote him?" is the question he comes back with. */}
      {answered && (
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your price</h2>
          <p style={{ fontSize: 26, fontWeight: 800, margin: "6px 0 2px", fontVariantNumeric: "tabular-nums" }}>
            {money(said!.amount!)}
          </p>
          <p className="muted small" style={{ margin: 0 }}>
            {[said!.on ? `given ${day(said!.on)}` : null,
              said!.valid_until ? `good until ${day(said!.valid_until)}` : null].filter(Boolean).join(" · ")}
          </p>
          {said!.notes && <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-line" }}>{said!.notes}</p>}
          {bid.open && !showForm && (
            <p style={{ margin: "10px 0 0" }}>
              <a href={`/bid/${token}?again=1`} style={{ fontWeight: 700 }}>Change it →</a>
            </p>
          )}
        </div>
      )}

      {bid.settled && (
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <p className="small" style={{ margin: 0 }}>This one has been decided. Thank you for pricing it.</p>
        </div>
      )}
      {!bid.open && !bid.settled && (
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <p className="small" style={{ margin: 0 }}>This job is no longer taking prices.</p>
        </div>
      )}

      {/* WHAT IS BEING ASKED FOR. The lines are the thing every price is
          judged against, so they are the page, not an appendix. */}
      {bid.scope_summary && (
        <div className="card" style={{ marginBottom: 14, padding: "16px 20px" }}>
          <p style={{ margin: 0, fontSize: 15, whiteSpace: "pre-line" }}>{bid.scope_summary}</p>
        </div>
      )}

      {showForm ? (
        <form action={sendPrice.bind(null, token)} className="card" style={{ padding: "16px 20px", display: "grid", gap: 12 }}>
          <input type="hidden" name="items" value={bid.items.map((i) => i.scope_item_id).join(",")} />

          {bid.items.length > 0 && (
            <div>
              <h2 className="section-title" style={{ margin: "0 0 6px" }}>
                What the price covers · {bid.items.length} line{bid.items.length === 1 ? "" : "s"}
              </h2>
              <p className="muted small" style={{ margin: "0 0 8px" }}>
                Everything is ticked. Untick anything you are NOT including — it costs you nothing to be
                straight about it, and a price that says what it leaves out is worth more than one that does not.
              </p>
              <div style={{ display: "grid", gap: 7 }}>
                {bid.items.map((i) => (
                  <label key={i.scope_item_id} className="radio-opt"
                    style={{ display: "flex", gap: 9, alignItems: "flex-start", lineHeight: 1.35 }}>
                    <input type="checkbox" name={`inc_${i.scope_item_id}`} defaultChecked={i.included}
                      style={{ marginTop: 3 }} />
                    <span>{i.item}{!i.is_required && <span className="muted"> (optional)</span>}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="amount">Your price</label>
            <input id="amount" name="amount" className="input" inputMode="decimal" required
              defaultValue={said?.amount != null ? String(Math.round(said.amount)) : ""} placeholder="$" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="valid_until">Good until</label>
            <input id="valid_until" name="valid_until" type="date" className="input"
              defaultValue={said?.valid_until ?? ""} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="notes">Anything we should know</label>
            <textarea id="notes" name="notes" className="input" rows={4} defaultValue={said?.notes ?? ""}
              placeholder="What is not included, how long you need, when you could start." />
          </div>

          {/* The terms, when there are any - said before he commits, not after. */}
          {(bid.terms.deposit_pct != null || bid.terms.retainage_pct != null || bid.terms.net_days != null
            || bid.terms.workers_comp || bid.terms.coi) && (
            <p className="muted small" style={{ margin: 0 }}>
              Terms on this job:{" "}
              {[bid.terms.deposit_pct != null ? `${bid.terms.deposit_pct}% deposit` : null,
                bid.terms.retainage_pct != null ? `${bid.terms.retainage_pct}% retainage` : null,
                bid.terms.net_days != null ? `net ${bid.terms.net_days}` : null,
                bid.terms.workers_comp ? "workers' comp required" : null,
                bid.terms.coi ? "certificate of insurance" : null].filter(Boolean).join(" · ")}.
            </p>
          )}

          <div>
            <button className="btn">{answered ? "Change my price" : "Send my price"}</button>
          </div>
        </form>
      ) : bid.open && bid.items.length > 0 && (
        <div className="card" style={{ padding: "16px 20px" }}>
          <h2 className="section-title" style={{ margin: "0 0 6px" }}>What was asked for</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 5 }}>
            {bid.items.map((i) => <li key={i.scope_item_id} className="small">{i.item}</li>)}
          </ul>
        </div>
      )}

      <p className="muted small" style={{ margin: "14px 0 0" }}>
        You are seeing the town rather than the address. The address comes with the job, if it is yours.
        Nobody else&apos;s price is on this page, and yours is not on theirs.
      </p>
    </Shell>
  );
}

// No navigation on purpose: this page has one job and no elsewhere to go.
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 640, paddingTop: 28, paddingBottom: 56 }}>
        {children}
      </main>
    </div>
  );
}
