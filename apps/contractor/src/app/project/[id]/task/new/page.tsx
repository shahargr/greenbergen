import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, ChevronIcon, Notice, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import { NewTaskForm, type TaskType } from "./NewTaskForm";
import type { Target } from "@shared/inbox/data";

export const dynamic = "force-dynamic";

// A NEW TASK ON THIS SITE.
//
// Shahar (2026-09-14) asked for the screen and what goes on it: the name,
// work or a product, a description, attachments, and the KIND - one of which
// carries a target cost and a payee (migration 098).
//
// It is deliberately short. Everything a task can eventually carry - a stage,
// a holder, a date, a status line, money actually paid - is on the task screen
// it lands on afterwards. Asking for all of that up front is how a two-line
// note becomes a form nobody fills in, and the point of this screen is that
// writing something down on site costs nothing.
//
// ONE THING HAS TO BE SETTLED BEFORE THE TYPING: which project. Press Add task
// standing on "55 Walnut Drive" and there is nowhere to put it - the house is
// the folder that holds New build, Standby generator, Mortgage. The database
// has always refused this (fn_actions_not_on_property) but only at the moment
// you pressed the button, after you had written the thing out. Migration 103
// asks the same question first, and this screen turns the refusal into the
// list of projects under that roof.
//
// AND IT GOES TO THE OBVIOUS ONE. Shahar, looking at the chooser that fix
// produced: "i'm in 55 walnut drive; clicking on add task should have been
// for 55 walnut by default (new build) and not showing me others." Right -
// thirteen doors, six of them duplicate generators and seven of them
// mortgage and insurance, is not an improvement on an error. So the screen
// goes straight to the busiest piece of real work under the roof and says
// where it landed, with Change one tap away. The full list is still there
// behind ?pick=1, for when the guess is wrong.
type Targets = {
  project_name: string | null;
  takes_tasks: boolean;
  default_id: string | null;
  options: { id: string; name: string; standing: boolean; open_tasks: number }[];
};

export default async function NewTaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  // `from` is the property we were sent here from, so the form can say so and
  // offer the way back to the list; `pick` forces the list instead of the
  // default.
  // `parent` arrives when this was opened from inside a task: "Add a step
  // under this one". It is pre-picked below rather than left for the person
  // to find again in a list of a hundred and twenty-nine.
  // `trade` arrives when this was opened from a trade's own screen: the task
  // is filed under it without being asked (Shahar, 2026-09-15).
  searchParams: Promise<{ back?: string; error?: string; from?: string; pick?: string; parent?: string; trade?: string }>;
}) {
  const { id } = await params;
  const { back, error, from, pick, parent, trade: tradeQ } = await searchParams;
  const parentId = parent && /^[0-9a-f-]{36}$/i.test(parent) ? parent : null;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : `/project/${id}`;

  const w = stopwatch("/project/[id]/task/new");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/project/${id}/task/new`)}`);

  const [{ data: targetData }, { data: typeData }, { data: peopleData }, { data: payeeData }, { data: projectRows },
         { data: tradeRows }, { data: jobTradeRows }, { data: contractRows }, board] = await Promise.all([
    // May a task live here at all, and if not, where could it? (migration 103)
    w.step("targets", () => rpc<Targets>(supabase, "portal_task_targets", { p_project: id })),
    w.step("types", () => rpc<TaskType[]>(supabase, "portal_task_types")),
    // The people on this project - who a task can be ASSIGNED to.
    w.step("people", () => rpc<Target[]>(supabase, "portal_compose_targets")),
    // Who can be PAID here, which is a wider list: a supplier is hardly ever
    // a member of the project (migration 099).
    w.step("payees", () => rpc<{ contact_id: string; name: string }[]>(supabase, "portal_task_payees", { p_project: id })),
    // This project, and - when we were sent here from a property - the
    // property too, so the form can say which roof it is under. One read.
    w.step("project", async () => await supabase.from("projects")
      .select("id, project_name").in("id", from && from !== id ? [id, from] : [id])),
    w.step("trades", async () => await supabase.from("trades")
      .select("trade, sort_order, is_construction, is_worker_trade, is_supply, is_professional")
      .order("sort_order", { ascending: true, nullsFirst: false })),
    // THE JOB'S OWN TRADES (migration 164). Shahar (2026-09-17): "the trades
    // you can assign the task are only the ones listed under the project. if
    // you want to add a trade, then it should be added also to the project
    // level." These lead the picker; the rest of the catalogue sits under
    // "add another trade", and naming one adds it to the job.
    w.step("jobTrades", () => rpc<{ trade: string }[]>(supabase, "project_trade_list", { p_project: id })),
    w.step("contracts", async () => await supabase.from("contracts")
      .select("id, title, trade, status")
      .eq("project_id", id)
      .order("title", { ascending: true })),
    // What "part of" can point at: everything still open on this site. The
    // same read the project screen uses, so the two lists cannot disagree.
    w.step("board", () => getBoard()),
  ]);
  w.done();

  const targets = targetData ?? null;
  const rows = Array.isArray(projectRows) ? projectRows : [];
  const here = rows.find((r) => r.id === id)?.project_name ?? targets?.project_name ?? undefined;
  const roof = from && from !== id ? rows.find((r) => r.id === from)?.project_name ?? null : null;

  // THE PROPERTY ITSELF TAKES NO TASKS. Rather than let the form be filled in
  // and then refused, offer the projects under this roof: one tap, and the
  // same screen opens on a project that can hold the work.
  if (targets && targets.takes_tasks === false) {
    // One obvious home, and no question asked. The property id rides along so
    // the form can name where it came from and offer the list.
    if (targets.default_id && pick !== "1") {
      const q = new URLSearchParams({ back: to, from: id });
      if (parentId) q.set("parent", parentId);
      if (tradeQ) q.set("trade", tradeQ);
      redirect(`/project/${targets.default_id}/task/new?${q.toString()}`);
    }
    const options = targets.options ?? [];
    const work = options.filter((o) => !o.standing);
    const standing = options.filter((o) => o.standing);
    const row = (o: Targets["options"][number]) => (
      <Link key={o.id} className="home-row"
        href={`/project/${o.id}/task/new?back=${encodeURIComponent(to)}${tradeQ ? `&trade=${encodeURIComponent(tradeQ)}` : ""}`}>
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">{o.name}</span>
          <span className="m" style={{ display: "block" }}>
            {o.open_tasks === 0 ? "nothing open yet" : `${o.open_tasks} open ${o.open_tasks === 1 ? "task" : "tasks"}`}
          </span>
        </span>
        <ChevronIcon />
      </Link>
    );

    return (
      <Screen>
        <AppBar back={to} title="New task" sub={here} />
        <div className="body">
          <div className="hero">
            <h1 style={{ fontSize: 22 }}>Which project?</h1>
            <p className="lead">
              {here ? `“${here}” is the property` : "This is the property"} — the folder that holds the work.
              A task lives on one of the projects under it.
            </p>
          </div>

          {work.length > 0 && <div className="stack" style={{ gap: 0 }}>{work.map(row)}</div>}

          {standing.length > 0 && (
            <details className="home-panel">
              <summary className="home-row">
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">The standing ones</span>
                  <span className="m" style={{ display: "block" }}>Mortgage, insurance, taxes and the rest of what runs all year</span>
                </span>
                <span className="chev"><ChevronIcon /></span>
              </summary>
              <div className="drawer stack" style={{ gap: 0, paddingTop: 6 }}>{standing.map(row)}</div>
            </details>
          )}

          {options.length === 0 && (
            <Card soft pad>
              <div className="small">
                There is no open project under {here ? `“${here}”` : "this property"} yet. Start one first — a task
                needs a job to belong to.
              </div>
            </Card>
          )}
        </div>
      </Screen>
    );
  }

  const types = typeData ?? [];
  const trades = (tradeRows ?? []).map((t) => t.trade);
  const jobTrades = (Array.isArray(jobTradeRows) ? jobTradeRows : []).map((t) => t.trade).filter((t) => trades.includes(t));
  const openTasks = board.tasks
    .filter((t) => t.project_id === id && t.state === "open")
    .map((t) => ({ id: t.id, label: t.action }));
  // The task this one goes under, when we were sent here from inside it. Only
  // honoured if it is actually open on THIS project - a parent from another
  // job would be a quiet lie in the picker.
  const parentOf = parentId ? openTasks.find((t) => t.id === parentId)?.label ?? null : null;
  const contracts = (contractRows ?? []).map((c) => ({
    id: c.id,
    label: [c.title, c.trade].filter(Boolean).join(" · ") || "Contract",
  }));
  // portal_compose_targets groups people BY project, so the ones for this
  // site are one hop in - the same read and the same shape the task screen
  // uses for its assignee list.
  // The seat and its RANK come through now (migration 131). Shahar
  // (2026-09-15): "sort assigned to drop down: first, list the PM, GC, Owner.
  // then, list the rest of the assigned contractors." The database already
  // sorts by rank; the form splits the list at 50, which is exactly the line
  // between the people who run the job and the people who do the work.
  const people = (Array.isArray(peopleData) ? peopleData : [])
    .find((x) => x.project_id === id)?.people
    .map((p) => ({ contact_id: p.contact_id, name: p.name, seat: p.seat, rank: p.rank ?? 0 })) ?? [];

  // A trade off the URL is untrusted: it only counts if it is one of ours.
  const onTrade = tradeQ && trades.includes(tradeQ) ? tradeQ : null;

  return (
    <Screen>
      <AppBar back={to} title="New task" sub={here} />
      <div className="body">
        {error && <Notice kind="error" title="Not added.">{error}</Notice>}

        <div className="hero">
          <h1 style={{ fontSize: 22 }}>{parentOf ? "What is the next step?" : "What needs doing?"}</h1>
          <p className="lead">
            {parentOf
              ? <>A step under <strong>{parentOf}</strong>. That task cannot close while this one is open.</>
              : <>A name is enough to get it on the board. Everything else — who holds it, when it is
                due, what it ends up costing — goes on afterwards.</>}
          </p>
        </div>

        {/* We guessed, so we say so. A guess you cannot see is the one that
            files a task on the wrong job for a month. */}
        {roof && (
          <Card soft pad className="tight">
            <div className="small">
              Going on <strong>{here}</strong>, under {roof}.{" "}
              <Link href={`/project/${from}/task/new?pick=1&back=${encodeURIComponent(to)}`}>Change</Link>
            </div>
          </Card>
        )}

        {/* NOT A FORM ANY MORE. Shahar (2026-09-15): "change this to a step
            by step, where first step saves some info." Each pass is its own
            database call made from the browser, so the task exists after the
            first one and the rest are patches onto it - which is not
            something a single posting form can do. */}
        <NewTaskForm projectId={id} back={to} types={types} people={people}
          payees={payeeData ?? []} trades={trades} jobTrades={jobTrades} contracts={contracts} openTasks={openTasks}
          defaultParent={parentOf ? parentId : null} defaultTrade={onTrade} />
      </div>
    </Screen>
  );
}
