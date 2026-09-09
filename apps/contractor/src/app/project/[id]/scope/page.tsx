import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import { ExpertTabs } from "@/components/ExpertTabs";
import { setTrades, copyLines, makePackages, addOwnerLine } from "./actions";

export const dynamic = "force-dynamic";

// Scope, in three steps that feed each other:
//
//   1  which trades this job needs        portal_scope_trades(_set)
//   2  which blueprint lines are in scope portal_scope_candidates / _copy
//   3  scope becomes draft bid packages   portal_scope_packages
//
// The blueprint is the library and the project owns its copy the moment it
// is taken (rulebook 41), which is why step 2 is a decision and not a link:
// amending the library must never rewrite scope somebody has signed.
//
// Only the step you are on opens. A GC on a phone standing on site should
// see one question, not a page of three.

type TradeRow = {
  trade: string; stage: string | null; suggested: boolean; chosen: boolean;
  blueprint_lines: number; scope_lines: number;
};

type Candidate = {
  id: string; trade: string; item: string; category: string | null;
  is_required: boolean; relevant: boolean; copied: boolean;
};

// What portal_scope_evidence actually returns - checked against live output,
// not against the portal's copy of this type, which also names
// owner_summary and audience. The function returns neither, which is why
// there is no "what you want" list on this screen: a line added in your own
// words lands in the scope like any other and cannot be told apart from one
// the blueprint gave you.
type Line = {
  id: string; trade: string | null; item: string;
  category: string | null; is_required: boolean; authority: string;
  evidence: unknown[];
};

export default async function ScopePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string; ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { step, ok, error } = await searchParams;

  const w = stopwatch("/project/[id]/scope");
  const supabase = await createClient();
  const [board, { data: tradeData }, { data: candData }, { data: lineData }, { data: mayEdit }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("trades", () => rpc<TradeRow[]>(supabase, "portal_scope_trades", { p_project: id })),
    w.step("candidates", () => rpc<Candidate[]>(supabase, "portal_scope_candidates", { p_project: id })),
    w.step("scope", () => rpc<Line[]>(supabase, "portal_scope_evidence", { p_project: id })),
    // Ask the database the exact question it will ask itself when the form
    // posts. portal_my_work's `seat` cannot answer it: that field is
    // coalesce(project_role, role), so it usually carries the job role -
    // "asset owner", "site GC" - and only falls back to the app-access role.
    // Matching it against owner/manager/collaborator hides the controls from
    // the very people who may use them.
    w.step("mayEdit", () => rpc<boolean>(supabase, "can_edit_project", { p_project_id: id })),
  ]);
  w.done();
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/scope`)}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const canEdit = mayEdit === true;

  const trades = tradeData ?? [];
  const candidates = candData ?? [];
  const lines = lineData ?? [];

  const chosen = trades.filter((t) => t.chosen);
  const scoped = chosen.filter((t) => t.scope_lines > 0);
  const totalScope = trades.reduce((n, t) => n + t.scope_lines, 0);
  const withProof = lines.filter((l) => (l.evidence?.length ?? 0) > 0).length;

  // Where you are, unless you asked for a step by name.
  const auto = chosen.length === 0 ? "1" : totalScope === 0 ? "2" : "3";
  const at = step === "1" || step === "2" || step === "3" ? step : auto;
  const href = (n: string) => `/project/${id}/scope?step=${n}`;

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="Scope" sub={seat.project_name} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}

        <div className="kicker">
          {chosen.length === 0
            ? "Nothing scoped yet"
            : `${chosen.length} trade${chosen.length === 1 ? "" : "s"} · ${totalScope} line${totalScope === 1 ? "" : "s"} in scope`}
        </div>

        {!canEdit && (
          <Notice kind="info" title="You are reading this one.">
            You are on this job as {seat.seat ?? "a viewer"}, which sees the scope without writing it.
          </Notice>
        )}

        {/* Step 1 - the trades. */}
        <Step n="1" at={at} title="Trades" done={`${chosen.length} chosen`} href={href("1")}>
          {at === "1" ? (
            <form action={setTrades.bind(null, id)} className="stack" style={{ gap: 8 }}>
              <p className="small text-muted" style={{ margin: 0 }}>
                Ticked ones are what the blueprint expects for a job named like this. Add or drop any.
              </p>
              {trades.filter((t) => t.suggested || t.chosen).map((t) => (
                <label className="check-row" key={t.trade}>
                  <input type="checkbox" name="trade" value={t.trade} defaultChecked={t.chosen || t.suggested} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{t.trade}</span>
                    <span className="m">
                      {t.blueprint_lines} line{t.blueprint_lines === 1 ? "" : "s"} in the blueprint
                      {t.scope_lines > 0 ? ` · ${t.scope_lines} already in scope` : ""}
                    </span>
                  </span>
                </label>
              ))}
              <details>
                <summary className="small text-muted" style={{ cursor: "pointer" }}>
                  Every other trade · {trades.filter((t) => !t.suggested && !t.chosen).length}
                </summary>
                <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                  {trades.filter((t) => !t.suggested && !t.chosen).map((t) => (
                    <label className="check-row" key={t.trade}>
                      <input type="checkbox" name="trade" value={t.trade} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="t">{t.trade}</span>
                        <span className="m">{t.blueprint_lines} line{t.blueprint_lines === 1 ? "" : "s"}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </details>
              {canEdit && <button className="btn btn-primary btn-block">Save the trades</button>}
            </form>
          ) : (
            <p className="small" style={{ margin: 0 }}>
              {chosen.length === 0
                ? <span className="text-muted">No trades chosen yet.</span>
                : <span className="chips">{chosen.map((t) => <span className="tag tag-neutral" key={t.trade}>{t.trade}</span>)}</span>}
            </p>
          )}
        </Step>

        {/* Step 2 - the lines those trades will price. */}
        <Step n="2" at={at} title="Line items"
          done={`${totalScope} the trade will price`}
          href={chosen.length ? href("2") : undefined}>
          {at === "2" && chosen.length === 0 && (
            <p className="small text-muted" style={{ margin: 0 }}>Choose the trades in step 1 first.</p>
          )}
          {at === "2" && chosen.length > 0 && (
            <form action={copyLines.bind(null, id)} className="stack" style={{ gap: 10 }}>
              <p className="small text-muted" style={{ margin: 0 }}>
                The blueprint&apos;s knowledge for these trades, in their language. What you keep becomes the
                line items on the proposal, so every bidder prices the same list.
              </p>
              {chosen.map((t) => {
                const rows = candidates.filter((c) => c.trade === t.trade);
                if (rows.length === 0) return null;
                // The lines that name this job lead and come ticked; the rest
                // of the trade's blueprint sits behind a fold.
                const lead = rows.filter((c) => c.relevant || c.copied);
                const rest = rows.filter((c) => !c.relevant && !c.copied);
                const row = (c: Candidate) => (
                  <label className="check-row" key={c.id}>
                    <input type="checkbox" name="line" value={c.id} defaultChecked={c.copied || c.relevant} />
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t" style={{ fontWeight: 500 }}>
                        {c.item.length > 220 ? `${c.item.slice(0, 220)}…` : c.item}
                      </span>
                      {c.is_required && <span className="m">required by the blueprint</span>}
                    </span>
                  </label>
                );
                return (
                  <div className="stack" style={{ gap: 6 }} key={t.trade}>
                    <div className="divider-label">
                      {t.trade} · {lead.length} for this job
                    </div>
                    {lead.length === 0 && (
                      <p className="small text-muted" style={{ margin: 0 }}>
                        Nothing in the blueprint names this job — pick from the full list below.
                      </p>
                    )}
                    {lead.map(row)}
                    {rest.length > 0 && (
                      <details>
                        <summary className="small text-muted" style={{ cursor: "pointer" }}>
                          The rest of the {t.trade} blueprint · {rest.length}
                        </summary>
                        <div className="stack" style={{ gap: 6, marginTop: 8 }}>{rest.map(row)}</div>
                      </details>
                    )}
                  </div>
                );
              })}
              <p className="tiny text-muted" style={{ margin: 0 }}>
                Unticking a line takes it back out of the scope. A line already carrying a contract or sitting
                in a bid package stays — scope somebody has committed to is not edited away from here.
              </p>
              {canEdit && <button className="btn btn-primary btn-block">Save the scope</button>}
            </form>
          )}
          {at !== "2" && (
            <p className="small" style={{ margin: 0 }}>
              {totalScope === 0
                ? <span className="text-muted">Nothing in scope yet.</span>
                : <span className="chips">{scoped.map((t) => (
                    <span className="tag tag-neutral" key={t.trade}>{t.trade} · {t.scope_lines}</span>
                  ))}</span>}
            </p>
          )}
        </Step>

        {/* Step 3 - scope becomes bid packages. */}
        <Step n="3" at={at} title="Bid packages"
          done={`${scoped.length} trade${scoped.length === 1 ? "" : "s"} ready`}
          href={totalScope ? href("3") : undefined}>
          {at === "3" && totalScope === 0 && (
            <p className="small text-muted" style={{ margin: 0 }}>Put something in scope first — step 2.</p>
          )}
          {at === "3" && totalScope > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="small text-muted" style={{ margin: 0 }}>
                One draft package per trade, carrying that trade&apos;s scope lines as the items bidders price.
                A trade that already has a package is left alone.
              </p>
              {scoped.map((t) => (
                <div className="home-row" key={t.trade} style={{ cursor: "default" }}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="t">{t.trade}</span>
                    <span className="m" style={{ display: "block" }}>
                      {t.scope_lines} line{t.scope_lines === 1 ? "" : "s"}{t.stage ? ` · ${t.stage}` : ""}
                    </span>
                  </span>
                </div>
              ))}
              {canEdit && (
                <form action={makePackages.bind(null, id)}>
                  <button className="btn btn-primary btn-block">Draft the bid packages</button>
                </form>
              )}
              <p className="tiny text-muted" style={{ margin: 0 }}>
                A trade you invite to bid sees the <strong>town</strong> until the job is awarded to them —
                the same rule the whole community runs on.
              </p>
            </div>
          )}
        </Step>

        {/* A line the blueprint does not carry. It joins the scope like any
            other, so it is priced, tasked and proved the same way. */}
        {canEdit && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Add a line of your own</div>
            <Card pad>
              <p className="small text-muted" style={{ margin: "0 0 10px" }}>
                Something this job needs that no blueprint knows about. Say it as the result you are paying
                for; it joins the scope and shows up under its trade.
              </p>
              <form action={addOwnerLine.bind(null, id)} className="stack" style={{ gap: 8 }}>
                <div className="field">
                  <label htmlFor="owner_summary">What you want</label>
                  <input id="owner_summary" name="owner_summary" className="input" required
                    placeholder="The power comes back on by itself when the grid drops" />
                </div>
                <details>
                  <summary className="small text-muted" style={{ cursor: "pointer" }}>
                    Say it in trade terms too (optional)
                  </summary>
                  <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                    <div className="field">
                      <label htmlFor="item">What the contractor prices</label>
                      <input id="item" name="item" className="input"
                        placeholder="Automatic transfer switch, service-rated, whole-house" />
                      <p className="hint">
                        Fill this and the line goes to both sides: your words on the job, these words in the
                        proposal.
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor="trade">Whose trade is it</label>
                      <input id="trade" name="trade" className="input" list="scope-trades"
                        placeholder="Electrical" />
                      <datalist id="scope-trades">
                        {trades.map((t) => <option value={t.trade} key={t.trade} />)}
                      </datalist>
                    </div>
                  </div>
                </details>
                <button className="btn btn-secondary">Add to the scope</button>
              </form>
            </Card>
          </section>
        )}

        {/* Evidence lives on its own screen - a signed URL per file is not a
            cost the wizard should pay. */}
        <Link href={`/project/${id}/scope/evidence`} className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Scope &amp; evidence</span>
            <span className="m" style={{ display: "block" }}>
              {lines.length === 0
                ? "Nothing in scope to prove yet"
                : `${withProof} of ${lines.length} line${lines.length === 1 ? "" : "s"} shown done`}
            </span>
          </span>
          <ChevronIcon />
        </Link>
      </div>
      <ExpertTabs manages current="projects" tasks={board.tasks.filter((t) => t.state === "open").length} />
    </Screen>
  );
}

// One step of the three. Open when you are on it, a one-line summary and a
// way back when you are not.
function Step({ n, at, title, done, href, children }: {
  n: string; at: string; title: string; done: string; href?: string; children: React.ReactNode;
}) {
  const active = at === n;
  return (
    <section className={`step ${active ? "active" : ""}`} style={{ marginTop: 14 }}>
      <span className="n">{n}</span>
      <div className="stack" style={{ gap: 8, minWidth: 0 }}>
        <div className="between" style={{ gap: 10, alignItems: "baseline" }}>
          <span className="t">{title}</span>
          <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>
            {done}{!active && href && <> · <Link href={href}>change</Link></>}
          </span>
        </div>
        {children}
      </div>
    </section>
  );
}
