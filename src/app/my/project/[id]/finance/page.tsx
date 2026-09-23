import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  saveBudgetLine, deleteBudgetLine, seedBudget, startBid, linkContract, unlinkContract,
} from "./actions";
import {
  LinesBoard, type BudgetLine, type ContractOpt, type Unattached,
} from "./LinesBoard";

export const dynamic = "force-dynamic";

type SeedSource = { id: string; name: string; lines: number };
type Board = {
  ok: boolean; reason?: string;
  lines: BudgetLine[]; contracts: ContractOpt[]; seed_sources: SeedSource[];
  unattached: Unattached | null;
  trades: string[] | null; phases: string[] | null; cost_types: string[] | null;
};

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

// The budget wizard: set the budget per line, send each line out to bid,
// and file the signed contract back against it. The rows themselves live in
// LinesBoard (client): one line each, unfold for payments and schedule, a
// pencil to edit with a floating save, and a catcher for unfiled spend.
// Nothing is stored twice: target lives on the line, agreed is derived from
// the contracts, actuals from transactions.
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

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 900 }}>
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
              &ldquo;Start a bid&rdquo; on a line opens a package in the <Link href={`/my/project/${id}/bids`}>bid room</Link> carrying
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
              A line won through the bid room is filed automatically. For work agreed outside it,
              unfold the line and pick the contract — the agreed figure is read from the contract,
              never typed twice. The trash can beside a linked line disconnects it.
            </p>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>
              {linked.length === 0 ? "No line has a contract filed yet." : `${money(lines.reduce((n, l) => n + (l.agreed_amount ?? 0), 0))} agreed across ${linked.length} lines.`}
            </p>
          )}
        </div>

        {/* The lines — one each, unfold for the rest. */}
        <div className="card" style={{ display: "grid", gap: 10, minWidth: 0 }}>
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
            <LinesBoard
              projectId={id}
              lines={lines}
              contracts={board.contracts ?? []}
              unattached={board.unattached}
              trades={board.trades ?? []}
              phases={board.phases ?? []}
              q={q ?? null}
              acts={{
                save: saveBudgetLine.bind(null, id),
                del: deleteBudgetLine.bind(null, id),
                link: linkContract.bind(null, id),
                unlink: unlinkContract.bind(null, id),
                startBid: startBid.bind(null, id),
              }}
            />
          )}
        </div>
      </div>
    </main>
  );
}
