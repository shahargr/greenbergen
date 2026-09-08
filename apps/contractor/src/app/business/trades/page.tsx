import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { getMe } from "@/lib/me";
import { AppBar, Notice, Screen } from "@shared/ui";
import { saveTrades } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your trades" };

// The picker is driven by the trades table, never a hardcoded list - it
// carries the NJ licence label per trade, and homeowner_post_internal
// matches bidders on exactly this column. Grouped by the stage of a build
// so a plumber is not reading through cabinetry.
type Trade = { trade: string; stage: string | null; licence: string | null; needs_docs: boolean };

export default async function TradesPage({ searchParams }: { searchParams: Promise<{ ok?: string; error?: string }> }) {
  const { ok, error } = await searchParams;
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/business/trades");
  const supabase = await createClient();
  const { data } = await rpc<Trade[]>(supabase, "contractor_trade_catalogue");
  const all = data ?? [];
  const mine = new Set(me.trades.map((t) => t.trade));

  const stages = all.reduce<Record<string, Trade[]>>((acc, t) => {
    const k = t.stage ?? "Other";
    (acc[k] ??= []).push(t);
    return acc;
  }, {});

  return (
    <Screen>
      <AppBar back="/business" title="Your trades" />
      <form action={saveTrades} className="body">
        {ok && <div className="banner-ok">Saved. Work in these trades will reach you.</div>}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="hero">
          <h1>What do you do?</h1>
          <p className="lead">Pick everything you actually take on. This is what decides which jobs reach you — and which licence we&apos;ll ask for.</p>
        </div>

        {Object.entries(stages).map(([stage, list]) => (
          <section className="stack" style={{ gap: 8 }} key={stage}>
            <div className="divider-label">{stage}</div>
            {list.map((t) => (
              <label className="choice" key={t.trade}>
                <span className="radio">
                  <input type="checkbox" name="trade" value={t.trade} defaultChecked={mine.has(t.trade)} />
                  <span className="dot" />
                </span>
                <span className="txt">
                  {t.trade}
                  {t.licence && <small>Needs a {t.licence}</small>}
                </span>
              </label>
            ))}
          </section>
        ))}

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block">Save my trades</button>
        </div>
      </form>
    </Screen>
  );
}
