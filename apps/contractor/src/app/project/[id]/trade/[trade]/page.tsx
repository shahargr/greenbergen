import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { getBoard, groupTasks, money, runs } from "@/lib/board";
import type { SiteWeek } from "../../SiteWeek";

export const dynamic = "force-dynamic";

// ONE TRADE ON ONE SITE. Shahar (2026-09-11): "show a panel for every trade
// working on site this week, allowing to click on it and drill down to its
// tasks / payments / etc."
//
// This is the drill-down. Everything about that trade on this property, in
// the order a person running the site asks for it: who is here, what is
// late, what is due, what it costs and what has been paid, then the work
// itself. No new money function - it reads the same contracts the week panel
// counted, which are gated by can_view_project_financials, so a trade
// looking at their own row sees their work and not the budget.
export default async function TradePage({
  params, searchParams,
}: {
  params: Promise<{ id: string; trade: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  const { id, trade: raw } = await params;
  const { show } = await searchParams;
  const trade = decodeURIComponent(raw);
  const wantDone = show === "done" || show === "all";

  const w = stopwatch("/project/[id]/trade/[trade]");
  const supabase = await createClient();
  const [board, { data: weekData }] = await Promise.all([
    w.step("board", () => getBoard({ closed: wantDone ? 500 : 0 })),
    w.step("week", () => rpc<SiteWeek>(supabase, "portal_site_week", { p_project: id })),
  ]);
  if (!board.signed_in) redirect(`/login?next=/project/${id}/trade/${raw}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const manages = runs(seat);

  // Everything at or beneath this project, the same family the project
  // screen uses - the work lives on the jobs, not on the container.
  const family = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of board.seats) {
      if (s.parent_project_id && family.has(s.parent_project_id) && !family.has(s.project_id)) {
        family.add(s.project_id); grew = true;
      }
    }
  }
  const nameOf = new Map(board.seats.map((s) => [s.project_id, s.project_name]));
  const all = board.tasks.filter((t) => t.project_id && family.has(t.project_id) && t.trade === trade);
  const open = all.filter((t) => t.state === "open");
  const done = all.filter((t) => t.state === "closed");
  const shown = show === "done" ? done : show === "all" ? all : open;
  const sections = groupTasks(shown, "timing");
  const today = new Date().toISOString().slice(0, 10);

  const row = (weekData?.trades ?? []).find((t) => t.trade === trade) ?? null;
  const contracts = row?.contracts ?? [];
  const agreed = contracts.reduce((n, c) => n + (c.amount ?? 0), 0);
  const paid = contracts.reduce((n, c) => n + (c.paid ?? 0), 0);
  w.done();

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title={trade} sub={seat.project_name} />
      <div className="body">
        {row?.phase && <div className="kicker">{row.phase}</div>}

        <div className="tiles quad" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <Stat n={String(open.length)} label="open" />
          <Stat n={String(row?.late ?? open.filter((t) => t.target_date && t.target_date < today).length)}
            label="late" tone={(row?.late ?? 0) > 0 ? "status" : undefined} />
          <Stat n={String(row?.due_this_week ?? 0)} label="due this week" />
        </div>

        {/* Who has been here this week, out of the roster. */}
        {(row?.people?.length ?? 0) > 0 && (
          <Card soft pad>
            <div className="small" style={{ fontWeight: 700 }}>
              On site this week{row!.days_on_site > 0 ? ` · ${row!.days_on_site} ${row!.days_on_site === 1 ? "day" : "days"}` : ""}
            </div>
            <div className="tiny text-muted" style={{ marginTop: 4 }}>
              {row!.people.map((p) => p.name).join(" · ")}
            </div>
          </Card>
        )}

        {/* THE MONEY. Only what the money ladder already lets this person
            see - portal_site_week returns no contracts otherwise. */}
        {contracts.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Money · {money(agreed) ?? "—"} agreed</div>
            {contracts.map((c) => (
              <div className="home-row" key={c.id} style={{ cursor: "default", alignItems: "flex-start" }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{c.title}</span>
                  <span className="m" style={{ display: "block" }}>
                    {[money(c.amount) ? `${money(c.amount)} agreed` : null,
                      money(c.paid) ? `${money(c.paid)} paid` : "nothing paid yet"].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </div>
            ))}
            <Link href={`/project/${id}/money`} className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">{money(agreed - paid) ? `${money(agreed - paid)} outstanding` : "Milestones and payments"}</span>
                <span className="m" style={{ display: "block" }}>The schedule, what was paid, and the changes</span>
              </span>
              <ChevronIcon />
            </Link>
          </section>
        )}

        {/* THE WORK. */}
        <section className="stack" style={{ gap: 14 }}>
          <div className="divider-label">
            {show === "done" ? "Done" : show === "all" ? "All work" : "Open work"} · {shown.length}
          </div>
          <nav className="chips" aria-label="Which tasks">
            <Chip href={`/project/${id}/trade/${raw}`} on={!show} label={`Open · ${open.length}`} />
            <Chip href={`/project/${id}/trade/${raw}?show=done`} on={show === "done"} label={wantDone ? `Done · ${done.length}` : "Done"} />
            <Chip href={`/project/${id}/trade/${raw}?show=all`} on={show === "all"} label="All" />
          </nav>

          {shown.length === 0 && (
            <Card soft pad><div className="small">
              {show === "done" ? `Nothing finished in ${trade.toLowerCase()} yet.` : `Nothing open in ${trade.toLowerCase()}.`}
            </div></Card>
          )}

          {sections.map((b) => (
            <div key={b.key}>
              <div className="bucket">
                <span className={`h ${b.tone === "status" ? "late" : ""}`}>{b.label}</span>
                <span className="n">{b.rows.length}</span>
              </div>
              <div className="bucket-rows">
                {b.rows.map((t) => (
                  <Link key={t.id} href={`/task/${t.id}?back=${encodeURIComponent(`/project/${id}/trade/${raw}`)}`}>
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="t">{t.action}</span>
                      <span className="m">
                        {[
                          t.project_id && t.project_id !== id ? (nameOf.get(t.project_id) ?? t.project) : null,
                          t.contract,
                          t.assignee ?? (manages ? "unassigned" : null),
                          t.status !== "Not Started" ? t.status : null,
                        ].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {t.state === "open" && t.priority === "High" && <span className="tag tag-outline" style={{ whiteSpace: "nowrap" }}>High</span>}
                    {t.state === "closed" ? (
                      <span className="tag tag-neutral" style={{ whiteSpace: "nowrap" }}>{t.completed_on ? shortDate(t.completed_on) : "done"}</span>
                    ) : t.target_date ? (
                      <span className={`tag ${t.target_date < today ? "tag-status" : "tag-neutral"}`} style={{ whiteSpace: "nowrap" }}>
                        {shortDate(t.target_date)}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </section>

        {all.length === 0 && contracts.length === 0 && (
          <Notice title={`Nothing is filed under ${trade.toLowerCase()} on this site.`}>
            A task joins a trade when it is given a contract or a scope line.
          </Notice>
        )}

        <Link href={`/project/${id}/scope`} className="home-row">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">Scope</span>
            <span className="m" style={{ display: "block" }}>The lines this trade is priced against</span>
          </span>
          <ChevronIcon />
        </Link>
      </div>
    </Screen>
  );
}

function Chip({ href, on, label }: { href: string; on: boolean; label: string }) {
  return (
    <Link href={href} aria-current={on ? "page" : undefined}
      className={`tag ${on ? "" : "tag-neutral"}`}
      style={{ textDecoration: "none", padding: "7px 12px", fontSize: 12 }} scroll={false}>
      {label}
    </Link>
  );
}

function Stat({ n, label, tone }: { n: string; label: string; tone?: "status" }) {
  return (
    <div className="tile" style={{ minHeight: 0, alignItems: "flex-start", textAlign: "left", gap: 2, padding: "12px 12px 10px" }}>
      <div className="mono" style={{ fontFamily: "var(--font-heading)", fontWeight: 700, fontSize: 22, color: tone === "status" ? "var(--color-status)" : undefined }}>{n}</div>
      <div className="tiny text-muted">{label}</div>
    </div>
  );
}
