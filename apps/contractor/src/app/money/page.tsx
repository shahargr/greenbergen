import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { AppBar, Card, ChevronIcon, Screen } from "@shared/ui";
import { inCurrency } from "@shared/finance/types";
import { getBoard, money, runs } from "@/lib/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Money" };

type Entry = {
  id: string; description: string | null; amount: number | null; currency: string;
  paid_on: string | null; status: string; direction: "in" | "out" | null;
  project_id: string; project: string; trade: string | null; payee: string | null;
  from_account: string | null; action_id: string | null; contract_id: string | null;
};

// MONEY, GROUPED THE WAY THE WORK IS.
//
// Shahar (2026-09-14): "under money, club transactions by projects, and then
// by trade."
//
// This screen used to be a list of PROJECTS - one row each, what you are owed,
// and a way in. The payments themselves were only ever reachable one job at a
// time, which is no use at all when the question is "what have I spent on
// framing" or "where did this month go". So the projects are still the top
// level, but each one opens onto its trades, and each trade onto its
// payments, with what it cost carried at every level.
//
// A payment with no trade is filed under "No trade recorded" rather than
// hidden, because that is a thing somebody has to fix and hiding it is how it
// stays unfixed.
export default async function MoneyPage() {
  const supabase = await createClient();
  const [b, { data: ledgerData }] = await Promise.all([
    getBoard(),
    rpc<Entry[]>(supabase, "portal_money_ledger"),
  ]);
  if (!b.signed_in) redirect("/login?next=/money");

  const entries = Array.isArray(ledgerData) ? ledgerData : [];
  const owed = b.seats.reduce((a, s) => a + (s.owed ?? 0), 0);
  const owedJobs = b.seats.filter((s) => s.owed > 0).length;

  // Money that came back, or never went, is not a cost.
  const SPENT_NOT = ["refunded", "cancelled", "void"];
  // What a set of entries adds up to, PER CURRENCY. A shekel loan and a
  // dollar invoice do not add up to a number, and pretending they do is the
  // bug Shahar caught on the family loan - so they are kept apart and shown
  // side by side rather than summed into a lie.
  const totals = (rows: Entry[]) => {
    const by = new Map<string, number>();
    for (const t of rows) {
      if (t.amount == null || SPENT_NOT.includes(t.status)) continue;
      const sign = t.direction === "in" ? -1 : 1;
      by.set(t.currency, (by.get(t.currency) ?? 0) + sign * t.amount);
    }
    return [...by.entries()]
      .filter(([, v]) => Math.abs(v) > 0.005)
      .map(([ccy, v]) => inCurrency(v, ccy));
  };

  // Project, then trade. Insertion order follows the ledger's own sort -
  // newest payment first - so the project you touched last is at the top.
  const byProject = new Map<string, { name: string; rows: Entry[] }>();
  for (const t of entries) {
    const g = byProject.get(t.project_id) ?? { name: t.project, rows: [] };
    g.rows.push(t);
    byProject.set(t.project_id, g);
  }

  const tradesOf = (rows: Entry[]) => {
    const m = new Map<string, Entry[]>();
    for (const t of rows) {
      const k = t.trade ?? "";
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return [...m.entries()]
      // A named trade before the unfiled heap, then the heaviest first.
      .sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1].length - a[1].length || a[0].localeCompare(b[0]));
  };

  return (
    <Screen>
      <AppBar back="/work" title="Money" />
      <div className="body">
        <div className="hero">
          <h1>Money</h1>
          <p className="lead">
            {owed > 0
              ? `${money(owed)} owed to you across ${owedJobs} ${owedJobs === 1 ? "job" : "jobs"}.`
              : "Every payment on every job you hold a seat on, by project and by trade."}
          </p>
        </div>

        {entries.length === 0 && (
          <Card soft pad><div className="small">No payments recorded on any job you hold a seat on yet.</div></Card>
        )}

        {[...byProject.entries()].map(([pid, g]) => {
          const seat = b.seats.find((s) => s.project_id === pid);
          return (
            <details className="home-panel" key={pid} open={byProject.size === 1}>
              <summary className="home-row">
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{g.name}</span>
                  <span className="m" style={{ display: "block" }}>
                    {[
                      `${g.rows.length} ${g.rows.length === 1 ? "payment" : "payments"}`,
                      ...totals(g.rows),
                      seat && runs(seat) ? "you run it" : seat?.seat,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {seat && seat.owed > 0 && (
                  <span className="tag tag-status" style={{ whiteSpace: "nowrap" }}>{money(seat.owed)} owed</span>
                )}
                <span className="chev"><ChevronIcon /></span>
              </summary>

              <div className="drawer stack" style={{ gap: 8, paddingTop: 10 }}>
                {tradesOf(g.rows).map(([trade, rows]) => (
                  <details className="ledger-trade" key={trade || "none"}>
                    <summary>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="t">{trade || "No trade recorded"}</span>
                        <span className="m">
                          {[`${rows.length} ${rows.length === 1 ? "payment" : "payments"}`, ...totals(rows)].join(" · ")}
                        </span>
                      </span>
                      <span className="chev"><ChevronIcon /></span>
                    </summary>
                    <ul className="ledger-rows">
                      {rows.map((t) => {
                        const body = (
                          <>
                            <span className="grow" style={{ minWidth: 0 }}>
                              <span className="t">{t.description || t.payee || "Payment"}</span>
                              <span className="m">
                                {[
                                  t.payee && t.description ? t.payee : null,
                                  t.paid_on ? shortDate(t.paid_on) : "no date",
                                  t.from_account,
                                  t.status,
                                ].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                            <span className={`amt${t.direction === "in" ? " in" : ""}`}>
                              {t.direction === "in" ? "+" : ""}{inCurrency(t.amount, t.currency)}
                            </span>
                          </>
                        );
                        // A payment filed against a task opens that task,
                        // where its receipt and its history are. One with no
                        // task has nowhere better to go than the project.
                        return (
                          <li key={t.id}>
                            {t.action_id
                              ? <Link href={`/task/${t.action_id}?back=${encodeURIComponent("/money")}`}>{body}</Link>
                              : <Link href={`/project/${t.project_id}/money`}>{body}</Link>}
                          </li>
                        );
                      })}
                    </ul>
                  </details>
                ))}

                <Link href={`/project/${pid}/money`} className="home-row">
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">Contracts, milestones and changes</span>
                    <span className="m" style={{ display: "block" }}>What was agreed on this job, and what is still to pay</span>
                  </span>
                  <ChevronIcon />
                </Link>
              </div>
            </details>
          );
        })}
      </div>
    </Screen>
  );
}
