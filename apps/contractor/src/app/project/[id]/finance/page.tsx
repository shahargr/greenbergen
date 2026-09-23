import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { getBoard, runs } from "@/lib/board";
import {
  saveBudgetLine, deleteBudgetLine, seedBudget, startBid, linkContract, unlinkContract,
} from "./actions";
import {
  LinesBoard, type BudgetLine, type ContractOpt, type Unattached,
} from "./LinesBoard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance" };

type SeedSource = { id: string; name: string; lines: number };
type Board = {
  ok: boolean; reason?: string;
  lines: BudgetLine[]; contracts: ContractOpt[]; seed_sources: SeedSource[];
  unattached: Unattached | null;
  trades: string[] | null; phases: string[] | null; cost_types: string[] | null;
};

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

// Project finance, INSIDE the project (Shahar, 2026-09-23: "admin has
// nothing to do with the build project - its a layer on top. any financial
// portal must sit inside each project"). Set the budget per line, send each
// line out to bid, and file the signed contract back against it. The rows
// live in LinesBoard: one line each, unfold for payments and schedule, a
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
  const [board, { data: boardData }, { data: project }] = await Promise.all([
    getBoard(),
    supabase.rpc("portal_budget_lines", { p_project: id, p_q: q ?? null }),
    supabase.from("projects").select("id, project_name, parent_project_id").eq("id", id).maybeSingle(),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/finance`)}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat || !project) notFound();
  const fin = (boardData ?? { ok: false }) as Board;
  if (!fin.ok || !runs(seat)) {
    return (
      <Screen>
        <AppBar back={`/project/${id}`} title="Finance" />
        <div className="body">
          <Notice kind="error">{fin.reason ?? "This project's budget is not yours to see."}</Notice>
        </div>
      </Screen>
    );
  }

  const lines = fin.lines ?? [];

  // THE WRONG DOOR, CAUGHT. One address is several project rows - the
  // property record and the jobs beneath it - and a Financials link can land
  // on the one with no budget (55 Walnut: the property row opened empty
  // while "New build" held the 101 lines). When THIS project has no lines
  // but a parent, sibling or child does, say so and point there.
  let holder: { id: string; project_name: string; n: number } | null = null;
  if (lines.length === 0 && !q) {
    const filters = [`parent_project_id.eq.${id}`];
    if (project.parent_project_id) {
      filters.push(`id.eq.${project.parent_project_id}`, `parent_project_id.eq.${project.parent_project_id}`);
    }
    const { data: family } = await supabase
      .from("projects").select("id, project_name").or(filters.join(",")).neq("id", id).is("trashed_at", null);
    const ids = (family ?? []).map((p) => p.id);
    if (ids.length > 0) {
      const { data: cats } = await supabase.from("budget_categories").select("project_id").in("project_id", ids);
      const counts = new Map<string, number>();
      for (const c of cats ?? []) counts.set(c.project_id, (counts.get(c.project_id) ?? 0) + 1);
      const best = (family ?? [])
        .map((p) => ({ id: p.id, project_name: p.project_name as string, n: counts.get(p.id) ?? 0 }))
        .filter((p) => p.n > 0)
        .sort((a, b) => b.n - a.n)[0];
      holder = best ?? null;
    }
  }

  const budgeted = lines.filter((l) => l.target_amount != null);
  const bidding = lines.filter((l) => l.package_id);
  const linked = lines.filter((l) => l.contract_id);
  const totalTarget = lines.reduce((n, l) => n + (l.target_amount ?? 0), 0);
  const totalExpected = lines.reduce((n, l) => n + (l.agreed_amount ?? l.target_amount ?? 0), 0);
  const totalPaid = lines.reduce((n, l) => n + l.actual_paid, 0);

  // Where you are, unless you asked for a particular step.
  const auto = lines.length === 0 ? "1" : bidding.length + linked.length === 0 ? "2" : "3";
  const at = step === "1" || step === "2" || step === "3" ? step : auto;
  const stepHref = (n: string) => `/project/${id}/finance?step=${n}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  // A plain render helper, not a component - the static-components rule.
  const head = ({ n, title, done, hint }: { n: string; title: string; done: string; hint: string }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <h2 className="card-title" style={{ margin: 0, opacity: at === n ? 1 : 0.75 }}>
        {n} · {title}
      </h2>
      <span className="small text-muted" style={{ whiteSpace: "nowrap" }}>
        {done}{at !== n && <> · <Link href={stepHref(n)}>{hint}</Link></>}
      </span>
    </div>
  );

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title={
        <span className="crumbs">
          <Link href={`/project/${id}`}>{seat.project_name}</Link>
          <span className="sep" aria-hidden>›</span>
          <span className="leaf">Finance</span>
        </span>
      } />
      <div className="body">
        {ok && <div className="banner-ok">{ok === "1" ? "Saved ✓" : `${ok} ✓`}</div>}
        {error && <Notice kind="error">{error}</Notice>}

        {holder && (
          <Card>
            <div style={{ display: "grid", gap: 6 }}>
              <strong>This looks like the wrong door.</strong>
              <p className="small text-muted" style={{ margin: 0 }}>
                &ldquo;{project.project_name}&rdquo; has no budget of its own. The budget for this home lives on
                &ldquo;{holder.project_name}&rdquo; — {holder.n} lines.
              </p>
              <div><Link className="btn btn-secondary" href={`/project/${holder.id}/finance`}>Open {holder.project_name}&apos;s finance →</Link></div>
            </div>
          </Card>
        )}

        {/* Step 1 — set the budget. */}
        <Card>
          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
            {head({ n: "1", title: "Set the budget", done: `${lines.length} lines · ${budgeted.length} priced`, hint: "change" })}
            {at === "1" ? (
              <div style={{ display: "grid", gap: 10 }}>
                <p className="small text-muted" style={{ margin: 0 }}>
                  One line per trade or large scope. Target is your estimate; it is never overwritten —
                  the agreed figure lands beside it when a contract is filed against the line.
                </p>
                {(fin.seed_sources ?? []).length > 0 && (
                  <form action={seedBudget.bind(null, id)} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <span className="small" style={{ fontWeight: 700 }}>Start from a line list:</span>
                    <select name="from" className="input" style={{ maxWidth: 300 }} defaultValue={fin.seed_sources[0]?.id}>
                      {fin.seed_sources.map((s) => (
                        <option key={s.id} value={s.id}>{s.name} · {s.lines} lines</option>
                      ))}
                    </select>
                    <button className="btn btn-secondary">Copy the list</button>
                    <span className="small text-muted">Names only — the amounts stay yours to set.</span>
                  </form>
                )}
                <form action={saveBudgetLine.bind(null, id)} style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {q && <input type="hidden" name="q" value={q} />}
                  <input name="category" className="input" placeholder="Line name (e.g. Roof Labor)" required style={{ flex: "2 1 180px" }} />
                  <select name="trade" className="input" defaultValue="" style={{ flex: "1 1 140px" }}>
                    <option value="">Trade — none</option>
                    {(fin.trades ?? []).map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <select name="phase" className="input" defaultValue="" style={{ flex: "1 1 150px" }}>
                    <option value="">Phase — none</option>
                    {(fin.phases ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                  <input name="target_amount" className="input" placeholder="$ target" inputMode="decimal" style={{ flex: "1 1 90px" }} />
                  <button className="btn btn-secondary">Add line</button>
                </form>
              </div>
            ) : (
              <p className="small text-muted" style={{ margin: 0 }}>
                {money(totalTarget)} targeted · {money(totalExpected)} expected once agreed prices replace targets.
              </p>
            )}
          </div>
        </Card>

        {/* Step 2 — send lines out to bid. */}
        <Card>
          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
            {head({ n: "2", title: "Bid it out", done: `${bidding.length} of ${lines.length} lines in the bid room`, hint: lines.length ? "change" : "set the budget first" })}
            {at === "2" ? (
              <p className="small text-muted" style={{ margin: 0 }}>
                &ldquo;Start a bid&rdquo; on a line opens a package in the <Link href={`/project/${id}/bids`}>bid room</Link> carrying
                the line&apos;s trade and target. Inviting, comparing and awarding all happen there —
                the award makes the contract and files it back here on its own.
              </p>
            ) : (
              <p className="small text-muted" style={{ margin: 0 }}>
                {bidding.length === 0 ? "Nothing out to bid yet." :
                  `${bidding.filter((l) => l.package_status === "awarded").length} awarded · ${bidding.filter((l) => l.package_status === "open").length} open.`}
              </p>
            )}
          </div>
        </Card>

        {/* Step 3 — every line meets its contract. */}
        <Card>
          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
            {head({ n: "3", title: "File the contracts", done: `${linked.length} of ${lines.length} lines contracted`, hint: "change" })}
            {at === "3" ? (
              <p className="small text-muted" style={{ margin: 0 }}>
                A line won through the bid room is filed automatically. For work agreed outside it,
                unfold the line and pick the contract — the agreed figure is read from the contract,
                never typed twice. The trash can beside a linked line disconnects it.
              </p>
            ) : (
              <p className="small text-muted" style={{ margin: 0 }}>
                {linked.length === 0 ? "No line has a contract filed yet." : `${money(lines.reduce((n, l) => n + (l.agreed_amount ?? 0), 0))} agreed across ${linked.length} lines.`}
              </p>
            )}
          </div>
        </Card>

        {/* The lines — one each, unfold for the rest. */}
        <Card>
          <div style={{ display: "grid", gap: 10, minWidth: 0 }}>
            <form method="get" style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              <input type="hidden" name="step" value={at} />
              <input name="q" className="input" placeholder="Search by name or trade…" defaultValue={q ?? ""} style={{ flex: "1 1 200px", maxWidth: 320 }} />
              <button className="btn btn-ghost">Search</button>
              {q && <Link className="small" href={stepHref(at)}>clear</Link>}
              <span className="small text-muted" style={{ marginLeft: "auto" }}>
                {money(totalPaid)} paid of {money(totalExpected)} expected
              </span>
            </form>

            {lines.length === 0 ? (
              <p className="small text-muted" style={{ margin: 0 }}>
                {q ? "No line matches that search." : "No budget lines yet — add one or copy a list above."}
              </p>
            ) : (
              <LinesBoard
                projectId={id}
                lines={lines}
                contracts={fin.contracts ?? []}
                unattached={fin.unattached}
                trades={fin.trades ?? []}
                phases={fin.phases ?? []}
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
        </Card>
      </div>
    </Screen>
  );
}
