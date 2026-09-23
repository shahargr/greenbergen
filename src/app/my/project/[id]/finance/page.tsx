import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  saveBudgetLine, deleteBudgetLine, seedBudget, startBid, linkContract, unlinkContract,
} from "./actions";

export const dynamic = "force-dynamic";

type BudgetLine = {
  id: string; category: string; phase: string | null; trade: string | null;
  cost_type: string | null; is_builder_scope: boolean;
  target_amount: number | null; agreed_amount: number | null; notes: string | null;
  actual_paid: number; open_committed: number;
  package_id: string | null; package_status: string | null;
  contract_id: string | null; contract_title: string | null; contract_status: string | null;
  contract_amount: number | null; contract_signed: string | null;
};
type ContractOpt = {
  id: string; title: string | null; trade: string | null; status: string;
  amount: number | null; budget_category_id: string | null;
};
type SeedSource = { id: string; name: string; lines: number };
type Board = {
  ok: boolean; reason?: string;
  lines: BudgetLine[]; contracts: ContractOpt[]; seed_sources: SeedSource[];
  trades: string[] | null; phases: string[] | null; cost_types: string[] | null;
};

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

// The budget wizard: set the budget per line, send each line out to bid,
// and file the signed contract back against it. Placeholder surface - the
// numbers come from portal_budget_lines, every write is a gated RPC, and
// nothing here is stored twice: target lives on the line, agreed is derived
// from the contracts, actuals from transactions.
export default async function FinancePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string; step?: string; ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { q, step, ok, error } = await searchParams;
  const supabase = await createClient();
  const [{ data: project }, { data: boardData }] = await Promise.all([
    supabase.from("projects").select("id, project_name").eq("id", id).maybeSingle(),
    supabase.rpc("portal_budget_lines", { p_project: id, p_q: q ?? null }),
  ]);
  const board = (boardData ?? { ok: false }) as Board;
  if (!project || !board.ok) {
    return (
      <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}>
        <p className="muted">{board.reason ?? "This project is not yours to see."}</p>
      </main>
    );
  }

  const lines = board.lines ?? [];
  const contracts = board.contracts ?? [];
  const budgeted = lines.filter((l) => l.target_amount != null);
  const bidding = lines.filter((l) => l.package_id);
  const linked = lines.filter((l) => l.contract_id);
  const totalTarget = lines.reduce((n, l) => n + (l.target_amount ?? 0), 0);
  const totalExpected = lines.reduce((n, l) => n + (l.agreed_amount ?? l.target_amount ?? 0), 0);
  const totalPaid = lines.reduce((n, l) => n + l.actual_paid, 0);

  // Where you are, unless you asked for a particular step.
  const auto = lines.length === 0 ? "1" : bidding.length + linked.length === 0 ? "2" : "3";
  const at = step === "1" || step === "2" || step === "3" ? step : auto;
  const stepHref = (n: string) => `/my/project/${id}/finance?step=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  // A plain render helper, not a component - the static-components rule.
  const head = ({ n, title, done, hint }: { n: string; title: string; done: string; hint: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <h2 className="section-title" style={{ margin: 0, color: at === n ? "var(--brand)" : undefined }}>
        {n} · {title}
      </h2>
      <span className="muted small" style={{ whiteSpace: "nowrap" }}>
        {done}{at !== n && <> · <Link href={stepHref(n)}>{hint}</Link></>}
      </span>
    </div>
  );

  // Contracts not yet filed against any line - the pool step 3 links from.
  const freeContracts = contracts.filter((c) => !c.budget_category_id);

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 860 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href={`/my/project/${id}`}>← {project.project_name}</Link></p>
      <span className="kicker">Project finance</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 12px" }}>Budget → bid → contract</h1>
      {ok && <p className="banner" style={{ background: "var(--ok)" }}>{ok === "1" ? "Saved ✓" : `${ok} ✓`}</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {/* Step 1 — set the budget. */}
        <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {head({ n: "1", title: "Set the budget", done: `${lines.length} lines · ${budgeted.length} priced`, hint: "change" })}
          {at === "1" ? (
            <div style={{ display: "grid", gap: 10 }}>
              <p className="muted small" style={{ margin: 0 }}>
                One line per trade or large scope. Target is your estimate; it is never overwritten —
                the agreed figure lands beside it when a contract is filed against the line.
              </p>
              {(board.seed_sources ?? []).length > 0 && (
                <form action={seedBudget.bind(null, id)} className="btn-row" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="small" style={{ fontWeight: 600 }}>Start from a line list:</span>
                  <select name="from" className="input" style={{ maxWidth: 300 }} defaultValue={board.seed_sources[0]?.id}>
                    {board.seed_sources.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} · {s.lines} lines</option>
                    ))}
                  </select>
                  <button className="btn small">Copy the list</button>
                  <span className="muted small">Names only — the amounts stay yours to set.</span>
                </form>
              )}
              <form action={saveBudgetLine.bind(null, id)} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {q && <input type="hidden" name="q" value={q} />}
                <input name="category" className="input" placeholder="Line name (e.g. Roof Labor)" required style={{ flex: "2 1 180px" }} />
                <select name="trade" className="input" defaultValue="" style={{ flex: "1 1 140px" }}>
                  <option value="">Trade — none</option>
                  {(board.trades ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <select name="phase" className="input" defaultValue="" style={{ flex: "1 1 150px" }}>
                  <option value="">Phase — none</option>
                  {(board.phases ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input name="target_amount" className="input" placeholder="$ target" inputMode="decimal" style={{ flex: "1 1 90px" }} />
                <button className="btn small">Add line</button>
              </form>
            </div>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              {money(totalTarget)} targeted · {money(totalExpected)} expected once agreed prices replace targets.
            </p>
          )}
        </div>

        {/* Step 2 — send lines out to bid. */}
        <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {head({ n: "2", title: "Bid it out", done: `${bidding.length} of ${lines.length} lines in the bid room`, hint: lines.length ? "change" : "set the budget first" })}
          {at === "2" ? (
            <p className="muted small" style={{ margin: 0 }}>
              &ldquo;Start bid&rdquo; on a line opens a package in the <Link href={`/my/project/${id}/bids`}>bid room</Link> carrying
              the line&apos;s trade and target. Inviting, comparing and awarding all happen there —
              the award makes the contract and files it back here on its own.
            </p>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              {bidding.length === 0 ? "Nothing out to bid yet." :
                `${bidding.filter((l) => l.package_status === "awarded").length} awarded · ${bidding.filter((l) => l.package_status === "open").length} open.`}
            </p>
          )}
        </div>

        {/* Step 3 — every line meets its contract. */}
        <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {head({ n: "3", title: "File the contracts", done: `${linked.length} of ${lines.length} lines contracted`, hint: "change" })}
          {at === "3" ? (
            <p className="muted small" style={{ margin: 0 }}>
              A line won through the bid room is filed automatically. For work agreed outside it —
              a handshake, paper signed before this system — pick the contract on the line below.
              The agreed figure is read from the contract, never typed twice.
              {freeContracts.length > 0 && <> {freeContracts.length} contract{freeContracts.length === 1 ? "" : "s"} on this project still unfiled.</>}
            </p>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              {linked.length === 0 ? "No line has a contract filed yet." : `${money(lines.reduce((n, l) => n + (l.agreed_amount ?? 0), 0))} agreed across ${linked.length} lines.`}
            </p>
          )}
        </div>

        {/* The lines themselves — one searchable table, actions per row. */}
        <div className="card" style={{ overflowX: "auto", display: "grid", gap: 10 }}>
          <form method="get" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="step" value={at} />
            <input name="q" className="input" placeholder="Search by name or trade…" defaultValue={q ?? ""} style={{ flex: "1 1 220px", maxWidth: 320 }} />
            <button className="btn ghost small">Search</button>
            {q && <Link className="small" href={stepHref(at)}>clear</Link>}
            <span className="muted small" style={{ marginLeft: "auto" }}>
              {money(totalPaid)} paid of {money(totalExpected)} expected
            </span>
          </form>

          {lines.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              {q ? "No line matches that search." : "No budget lines yet — add one or copy a list above."}
            </p>
          ) : (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Line</th>
                  <th style={{ textAlign: "right" }}>Target</th>
                  <th style={{ textAlign: "right" }}>Agreed</th>
                  <th style={{ textAlign: "right" }}>Paid</th>
                  <th style={{ textAlign: "right" }}>Left</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const expected = l.agreed_amount ?? l.target_amount;
                  const left = expected == null ? null : expected - l.actual_paid;
                  return (
                    <tr key={l.id}>
                      <td style={{ minWidth: 180 }}>
                        <span style={{ fontWeight: 600 }}>{l.category}</span>
                        <span className="muted small">
                          {l.trade && <> · {l.trade}</>}
                          {l.phase && <> · {l.phase}</>}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        {/* Target is editable in place — the wizard's "set budget" verb. */}
                        <form action={saveBudgetLine.bind(null, id)} style={{ display: "inline-flex", gap: 4 }}>
                          <input type="hidden" name="id" value={l.id} />
                          {q && <input type="hidden" name="q" value={q} />}
                          <input name="target_amount" defaultValue={l.target_amount ?? ""} placeholder="—"
                            inputMode="decimal" className="input" style={{ width: 84, textAlign: "right", padding: "2px 6px" }} />
                          <button className="btn ghost small" title="Save target">✓</button>
                        </form>
                      </td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(l.agreed_amount)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(l.actual_paid)}</td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap", color: left != null && left < 0 ? "var(--danger)" : undefined }}>
                        {left == null ? "—" : money(left)}
                      </td>
                      <td style={{ minWidth: 200 }}>
                        {l.contract_id ? (
                          <span className="small">
                            <span className="extra-chip" style={{ background: "var(--ok-soft)", color: "var(--ok)" }}>
                              {l.contract_signed ? "signed" : l.contract_status ?? "contracted"}
                            </span>{" "}
                            {l.contract_title ?? "Contract"}
                            <form action={unlinkContract.bind(null, id, l.id, l.contract_id)} style={{ display: "inline" }}>
                              {q && <input type="hidden" name="q" value={q} />}
                              <button className="linklike small muted" title="Unfile this contract" style={{ marginLeft: 6 }}>unlink</button>
                            </form>
                          </span>
                        ) : l.package_id ? (
                          <span className="small">
                            <span className="extra-chip">{l.package_status === "awarded" ? "awarded" : "bidding"}</span>{" "}
                            <Link href={`/my/project/${id}/bids/${l.package_id}`}>open the bid</Link>
                          </span>
                        ) : (
                          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                            <form action={startBid.bind(null, id, l.id, l.trade)} style={{ display: "inline" }}>
                              {q && <input type="hidden" name="q" value={q} />}
                              <button className="btn ghost small">Start bid</button>
                            </form>
                            {freeContracts.length > 0 && (
                              <details style={{ display: "inline-block" }}>
                                <summary className="small linklike" style={{ cursor: "pointer", listStyle: "none" }}>file a contract</summary>
                                <form action={linkContract.bind(null, id, l.id)} style={{ display: "flex", gap: 4, marginTop: 4 }}>
                                  {q && <input type="hidden" name="q" value={q} />}
                                  <select name="contract" className="input" style={{ maxWidth: 220 }}>
                                    {freeContracts.map((c) => (
                                      <option key={c.id} value={c.id}>
                                        {(c.title ?? c.trade ?? "Contract").slice(0, 40)}{c.amount != null ? ` · ${money(c.amount)}` : ""}
                                      </option>
                                    ))}
                                  </select>
                                  <button className="btn small">Link</button>
                                </form>
                              </details>
                            )}
                            <form action={deleteBudgetLine.bind(null, id, l.id)} style={{ display: "inline" }}>
                              {q && <input type="hidden" name="q" value={q} />}
                              <button className="linklike small muted" title="Delete this line">✕</button>
                            </form>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
