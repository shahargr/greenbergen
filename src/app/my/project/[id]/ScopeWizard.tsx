import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { scopeSetTrades, scopeCopyLines, scopeMakePackages } from "./actions";

type TradeRow = {
  trade: string; stage: string | null; suggested: boolean; chosen: boolean;
  blueprint_lines: number; scope_lines: number;
};
type Candidate = {
  id: string; trade: string; item: string; category: string | null;
  is_required: boolean; relevant: boolean; copied: boolean;
};

// Project scope in three clicks, each one a step that feeds the next:
//   1  which trades this job needs
//   2  which of the blueprint's lines are in scope for them
//   3  turn that scope into draft bid packages
// The scope lines are the project's own (project_scope_items); a bid package
// carries them as its items, so bidders price the same list the owner wrote.
export async function ScopeWizard({ projectId, step, canEdit }: { projectId: string; step?: string; canEdit: boolean }) {
  const supabase = await createClient();
  const [{ data: tradeData }, { data: candData }] = await Promise.all([
    supabase.rpc("portal_scope_trades", { p_project: projectId }),
    supabase.rpc("portal_scope_candidates", { p_project: projectId }),
  ]);
  const trades = ((tradeData ?? []) as TradeRow[]);
  const candidates = ((candData ?? []) as Candidate[]);
  const chosen = trades.filter((t) => t.chosen);
  const scoped = chosen.filter((t) => t.scope_lines > 0);
  const totalScope = trades.reduce((n, t) => n + t.scope_lines, 0);

  // Where you are, unless you asked for a particular step.
  const auto = chosen.length === 0 ? "1" : totalScope === 0 ? "2" : "3";
  const at = step === "1" || step === "2" || step === "3" ? step : auto;
  const stepHref = (n: string) => `/my/project/${projectId}?tab=scope&step=${n}#scope`;

  const Head = ({ n, title, done, hint }: { n: string; title: string; done: string; hint: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <h2 className="section-title" style={{ margin: 0, color: at === n ? "var(--brand)" : undefined }}>
        {n} · {title}
      </h2>
      <span className="muted small" style={{ whiteSpace: "nowrap" }}>
        {done}{at !== n && <> · <Link href={stepHref(n)}>{hint}</Link></>}
      </span>
    </div>
  );

  return (
    <div id="scope" style={{ display: "grid", gap: 14 }}>
      {/* Step 1 — the trades this job needs. */}
      <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <Head n="1" title="Trades" done={`${chosen.length} chosen`} hint="change" />
        {at === "1" ? (
          <form action={scopeSetTrades.bind(null, projectId)} style={{ display: "grid", gap: 8 }}>
            <p className="muted small" style={{ margin: 0 }}>
              Ticked ones are what the blueprint expects for a job like this. Add or drop any.
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 4 }}>
              {trades.filter((t) => t.suggested || t.chosen).map((t) => (
                <label key={t.trade} className="small" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                  <input type="checkbox" name="trade" value={t.trade} defaultChecked={t.chosen || t.suggested} />
                  <span style={{ fontWeight: 600 }}>{t.trade}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{t.blueprint_lines} lines</span>
                </label>
              ))}
            </div>
            <details>
              <summary className="small" style={{ cursor: "pointer" }}>Every other trade</summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 4, marginTop: 8 }}>
                {trades.filter((t) => !t.suggested && !t.chosen).map((t) => (
                  <label key={t.trade} className="small" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                    <input type="checkbox" name="trade" value={t.trade} />
                    <span>{t.trade}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{t.blueprint_lines}</span>
                  </label>
                ))}
              </div>
            </details>
            {canEdit && <div className="btn-row"><button className="btn small">Save trades → scope</button></div>}
          </form>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            {chosen.length === 0 ? <span className="muted">No trades chosen yet.</span>
              : chosen.map((t) => <span key={t.trade} className="extra-chip" style={{ marginRight: 4 }}>{t.trade}</span>)}
          </p>
        )}
      </div>

      {/* Step 2 — the scope lines for those trades. */}
      <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <Head n="2" title="Scope lines" done={`${totalScope} in scope`} hint={chosen.length ? "change" : "pick trades first"} />
        {at === "2" && chosen.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>Choose the trades in step 1 first.</p>
        )}
        {at === "2" && chosen.length > 0 && (
          <form action={scopeCopyLines.bind(null, projectId)} style={{ display: "grid", gap: 10 }}>
            <p className="muted small" style={{ margin: 0 }}>
              The blueprint&apos;s knowledge for these trades. What you keep becomes this project&apos;s scope of work, and every bidder prices the same list.
            </p>
            {chosen.map((t) => {
              const rows = candidates.filter((c) => c.trade === t.trade);
              if (rows.length === 0) return null;
              // The lines that name this job lead and come ticked; the rest of
              // the trade's blueprint sits behind a fold.
              const lead = rows.filter((c) => c.relevant || c.copied);
              const rest = rows.filter((c) => !c.relevant && !c.copied);
              const line = (c: Candidate) => (
                <label key={c.id} className="small" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0 }}>
                  <input type="checkbox" name="line" value={c.id} defaultChecked={c.copied || c.relevant} style={{ marginTop: 3 }} />
                  <span style={{ minWidth: 0 }}>
                    {c.is_required && <span className="extra-chip" style={{ fontSize: 10, marginRight: 4 }}>required</span>}
                    {c.item.length > 240 ? `${c.item.slice(0, 240)}…` : c.item}
                  </span>
                </label>
              );
              return (
                <div key={t.trade} style={{ display: "grid", gap: 4, borderTop: "1px solid #eef0ec", paddingTop: 8 }}>
                  <strong className="small">
                    {t.trade} · {lead.length} line{lead.length === 1 ? "" : "s"} for this job
                  </strong>
                  {lead.length === 0 && (
                    <span className="muted small">Nothing in the blueprint names this job — pick from the full list below.</span>
                  )}
                  {lead.map(line)}
                  {rest.length > 0 && (
                    <details>
                      <summary className="small muted" style={{ cursor: "pointer" }}>
                        The rest of the {t.trade} blueprint · {rest.length}
                      </summary>
                      <div style={{ display: "grid", gap: 4, marginTop: 6 }}>{rest.map(line)}</div>
                    </details>
                  )}
                </div>
              );
            })}
            {canEdit && <div className="btn-row"><button className="btn small">Save scope → packages</button></div>}
          </form>
        )}
        {at !== "2" && (
          <p className="small" style={{ margin: 0 }}>
            {totalScope === 0 ? <span className="muted">Nothing in scope yet.</span>
              : scoped.map((t) => <span key={t.trade} className="extra-chip" style={{ marginRight: 4 }}>{t.trade} · {t.scope_lines}</span>)}
          </p>
        )}
      </div>

      {/* Step 3 — scope becomes bid packages. */}
      <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <Head n="3" title="Bid packages" done={`${scoped.length} trade${scoped.length === 1 ? "" : "s"} ready`} hint="open" />
        {at === "3" && (
          <>
            {totalScope === 0
              ? <p className="muted small" style={{ margin: 0 }}>Put something in scope first — step 2.</p>
              : (
                <>
                  <p className="muted small" style={{ margin: 0 }}>
                    One draft package per trade, carrying that trade&apos;s scope lines as the items bidders price. Trades that already have a package are left alone.
                  </p>
                  {scoped.map((t) => (
                    <div key={t.trade} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                      <span><strong>{t.trade}</strong> <span className="muted">· {t.scope_lines} line{t.scope_lines === 1 ? "" : "s"}</span></span>
                      <span className="muted">{t.stage ?? "—"}</span>
                    </div>
                  ))}
                  {canEdit && (
                    <form action={scopeMakePackages.bind(null, projectId)} className="btn-row" style={{ marginTop: 4 }}>
                      <button className="btn small">Create the bid packages</button>
                      <Link href={`/my/project/${projectId}/bids`} className="btn ghost small">Open the planner →</Link>
                    </form>
                  )}
                </>
              )}
          </>
        )}
      </div>
    </div>
  );
}
