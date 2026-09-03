// Budget-vs-Actual rollup, grouped by stage (phase) then trade (category).
// Server component - all interactivity is native <details>. Fed by the
// portal_finance_rollup RPC, which is scoped to the caller's projects.

export type RollupTrade = {
  trade: string;
  cost_type: string | null;
  is_builder_scope: boolean;
  budget: number;
  agreed: number;
  actual_paid: number;
  open_committed: number;
};
export type RollupPhase = {
  phase: string;
  budget: number;
  agreed: number;
  actual_paid: number;
  open_committed: number;
  trades: RollupTrade[];
};
export type RollupProject = {
  project_id: string;
  project_name: string;
  budget: number;
  agreed: number;
  actual_paid: number;
  open_committed: number;
  phases: RollupPhase[];
};
export type Rollup = {
  projects: RollupProject[];
  totals: { budget: number; agreed: number; actual_paid: number; open_committed: number };
};

const money = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${(Math.round(n * 100) / 100).toLocaleString()}`;

// A thin two-segment bar: paid (solid) then committed-but-open (hatched),
// both as a share of budget. Over-budget spend clamps and turns red.
function Bar({ paid, open, budget }: { paid: number; open: number; budget: number }) {
  const over = budget > 0 && paid > budget;
  const paidPct = budget > 0 ? Math.min(100, (paid / budget) * 100) : paid > 0 ? 100 : 0;
  const openPct = budget > 0 ? Math.min(100 - paidPct, (open / budget) * 100) : 0;
  return (
    <div className="progressbar" style={{ background: "#eceee9" }}>
      <span style={{ width: `${paidPct}%`, background: over ? "#c0262d" : "#2f6b4f", display: "inline-block", height: "100%" }} />
      <span style={{ width: `${openPct}%`, background: "#cbb26b", display: "inline-block", height: "100%" }} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</span>
      <span style={{ fontSize: 17, fontWeight: 800, color: tone }}>{value}</span>
    </div>
  );
}

function TradeRow({ t }: { t: RollupTrade }) {
  const remaining = t.budget - t.actual_paid - t.open_committed;
  const over = t.budget > 0 && t.actual_paid + t.open_committed > t.budget;
  return (
    <div style={{ display: "grid", gap: 4, padding: "8px 0", borderTop: "1px solid #f0f1ee" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>
          {t.trade}
          {t.is_builder_scope && <span className="muted" style={{ fontWeight: 400 }}> · builder</span>}
        </span>
        <span className="small" style={{ whiteSpace: "nowrap" }}>
          <strong style={{ color: over ? "#c0262d" : undefined }}>{money(t.actual_paid)}</strong>
          <span className="muted"> / {money(t.budget)}</span>
        </span>
      </div>
      <Bar paid={t.actual_paid} open={t.open_committed} budget={t.budget} />
      <div className="muted" style={{ fontSize: 11, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {t.open_committed > 0 && <span>{money(t.open_committed)} scheduled</span>}
        {t.budget > 0 && (
          <span style={{ color: remaining < 0 ? "#c0262d" : undefined }}>
            {remaining < 0 ? `${money(-remaining)} over` : `${money(remaining)} left`}
          </span>
        )}
      </div>
    </div>
  );
}

function PhaseBlock({ ph }: { ph: RollupPhase }) {
  const remaining = ph.budget - ph.actual_paid - ph.open_committed;
  const over = ph.budget > 0 && ph.actual_paid + ph.open_committed > ph.budget;
  return (
    <details style={{ borderTop: "1px solid #e7e9e4", padding: "10px 0 4px" }}>
      <summary style={{ cursor: "pointer", listStyle: "none", display: "grid", gap: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{ph.phase}</span>
          <span className="small" style={{ whiteSpace: "nowrap" }}>
            <strong style={{ color: over ? "#c0262d" : undefined }}>{money(ph.actual_paid)}</strong>
            <span className="muted"> / {money(ph.budget)}</span>
          </span>
        </div>
        <Bar paid={ph.actual_paid} open={ph.open_committed} budget={ph.budget} />
        <span className="muted" style={{ fontSize: 11 }}>
          {ph.trades.length} {ph.trades.length === 1 ? "line" : "lines"}
          {ph.open_committed > 0 && ` · ${money(ph.open_committed)} scheduled`}
          {ph.budget > 0 && ` · ${remaining < 0 ? `${money(-remaining)} over` : `${money(remaining)} left`}`}
          {" · tap to open"}
        </span>
      </summary>
      <div style={{ marginTop: 6 }}>
        {ph.trades.map((t) => <TradeRow key={t.trade} t={t} />)}
      </div>
    </details>
  );
}

export function FinanceRollup({ rollup }: { rollup: Rollup }) {
  const projects = (rollup?.projects ?? []).filter((p) => p.budget > 0 || p.actual_paid > 0 || p.open_committed > 0);
  if (projects.length === 0) {
    return <p className="muted small" style={{ margin: 0 }}>No budget lines yet.</p>;
  }
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {projects.map((p) => {
        const remaining = p.budget - p.actual_paid - p.open_committed;
        return (
          // Each project is collapsed to its top line (Budget / Actual / Left);
          // the stage breakdown opens on demand.
          <details key={p.project_id} className="card" style={{ display: "grid", gap: 12 }}>
            <summary style={{ cursor: "pointer", listStyle: "none", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <strong style={{ fontSize: 16 }}>{p.project_name}</strong>
                <span className="muted small">stages ▾</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <Stat label="Budget" value={money(p.budget)} />
                <Stat label="Actual" value={money(p.actual_paid)} tone="#2f6b4f" />
                <Stat
                  label={remaining < 0 ? "Over" : "Left"}
                  value={money(Math.abs(remaining))}
                  tone={remaining < 0 ? "#c0262d" : "#a8842c"}
                />
              </div>
              <Bar paid={p.actual_paid} open={p.open_committed} budget={p.budget} />
            </summary>
            {p.open_committed > 0 && (
              <span className="muted" style={{ fontSize: 11 }}>
                Solid = paid · gold = {money(p.open_committed)} scheduled / committed
              </span>
            )}
            <div>
              {p.phases.map((ph) => <PhaseBlock key={ph.phase} ph={ph} />)}
            </div>
          </details>
        );
      })}
    </div>
  );
}
