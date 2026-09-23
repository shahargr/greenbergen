import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { rpcRetry } from "@/lib/rpc";
import type { Rollup, RollupProject } from "./FinanceRollup";

// Landing-page "Project finance" panel - a placeholder to grow later.
// Answers one question per project: budget per trade (or large scope, where
// a line names no trade), and where the money stands against it. Fed by
// portal_finance_rollup's by_trade key (222); the wizard behind each project
// sets budgets, opens bids and files contracts.

type TradeSlice = {
  label: string; is_trade: boolean;
  budget: number; agreed: number; actual_paid: number; open_committed: number;
};
type ProjectWithTrades = RollupProject & { by_trade?: TradeSlice[] };

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function MiniBar({ paid, open, budget }: { paid: number; open: number; budget: number }) {
  const over = budget > 0 && paid > budget;
  const paidPct = budget > 0 ? Math.min(100, (paid / budget) * 100) : paid > 0 ? 100 : 0;
  const openPct = budget > 0 ? Math.min(100 - paidPct, (open / budget) * 100) : 0;
  return (
    <div className="progressbar" style={{ background: "#eceee9" }}>
      <span style={{ width: `${paidPct}%`, background: over ? "var(--danger)" : "var(--ok)", display: "inline-block", height: "100%" }} />
      <span style={{ width: `${openPct}%`, background: "#cbb26b", display: "inline-block", height: "100%" }} />
    </div>
  );
}

export async function FinancePanel() {
  const supabase = await createClient();
  const { data } = await rpcRetry(supabase, "portal_finance_rollup");
  const rollup = (data ?? null) as Rollup | null;
  const projects = ((rollup?.projects ?? []) as ProjectWithTrades[])
    .filter((p) => p.budget > 0 || p.actual_paid > 0 || p.open_committed > 0);
  if (projects.length === 0) return null;
  const t = rollup!.totals;

  return (
    <section className="card" style={{ display: "grid", gap: 12, marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Project finance</h2>
        <Link className="small" href="/my/payments">all payments →</Link>
      </div>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {([
          ["Budget", money(t.budget), undefined],
          ["Agreed", money(t.agreed), undefined],
          ["Paid", money(t.actual_paid), "var(--ok)"],
          ["Left", money(t.budget - t.actual_paid - t.open_committed), "var(--warn)"],
        ] as const).map(([label, value, tone]) => (
          <div key={label} style={{ display: "grid", gap: 2 }}>
            <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
            <span style={{ fontSize: 17, fontWeight: 800, color: tone }}>{value}</span>
          </div>
        ))}
      </div>
      {projects.map((p) => {
        const slices = (p.by_trade ?? []).slice(0, 8);
        return (
          <details key={p.project_id} style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
            <summary style={{ cursor: "pointer", listStyle: "none", display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <strong>{p.project_name}</strong>
                <span className="small" style={{ whiteSpace: "nowrap" }}>
                  <strong>{money(p.actual_paid)}</strong>
                  <span className="muted"> paid / {money(p.budget)} · by trade ▾</span>
                </span>
              </div>
              <MiniBar paid={p.actual_paid} open={p.open_committed} budget={p.budget} />
            </summary>
            <div style={{ display: "grid", gap: 4, margin: "8px 0 4px" }}>
              {slices.map((s) => {
                const expected = s.agreed > 0 ? s.agreed : s.budget;
                const left = expected - s.actual_paid;
                return (
                  <div key={s.label} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                    <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.label}{!s.is_trade && <span className="muted"> · scope</span>}
                    </span>
                    <span style={{ whiteSpace: "nowrap" }}>
                      {money(s.actual_paid)}<span className="muted"> / {money(expected)}</span>
                      <span className="muted" style={{ color: left < 0 ? "var(--danger)" : undefined }}>
                        {" "}· {left < 0 ? `${money(-left)} over` : `${money(left)} left`}
                      </span>
                    </span>
                  </div>
                );
              })}
              {(p.by_trade ?? []).length > 8 && (
                <span className="muted small">…and {(p.by_trade ?? []).length - 8} more.</span>
              )}
              <div className="btn-row" style={{ marginTop: 4 }}>
                <Link className="btn ghost small" href={`/my/project/${p.project_id}/finance`}>
                  Budget → bid → contract wizard
                </Link>
              </div>
            </div>
          </details>
        );
      })}
    </section>
  );
}
