import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Notice, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import { NewTaskForm, type TaskType } from "./NewTaskForm";
import { createTask } from "./actions";
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
export default async function NewTaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; error?: string }>;
}) {
  const { id } = await params;
  const { back, error } = await searchParams;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : `/project/${id}`;

  const w = stopwatch("/project/[id]/task/new");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/project/${id}/task/new`)}`);

  const [{ data: typeData }, { data: peopleData }, { data: payeeData }, { data: projectRow },
         { data: tradeRows }, { data: contractRows }, board] = await Promise.all([
    w.step("types", () => rpc<TaskType[]>(supabase, "portal_task_types")),
    // The people on this project - who a task can be ASSIGNED to.
    w.step("people", () => rpc<Target[]>(supabase, "portal_compose_targets")),
    // Who can be PAID here, which is a wider list: a supplier is hardly ever
    // a member of the project (migration 099).
    w.step("payees", () => rpc<{ contact_id: string; name: string }[]>(supabase, "portal_task_payees", { p_project: id })),
    w.step("project", async () => await supabase.from("projects")
      .select("project_name").eq("id", id).maybeSingle()),
    w.step("trades", async () => await supabase.from("trades")
      .select("trade, sort_order, is_construction, is_worker_trade, is_supply, is_professional")
      .order("sort_order", { ascending: true, nullsFirst: false })),
    w.step("contracts", async () => await supabase.from("contracts")
      .select("id, title, trade, status")
      .eq("project_id", id)
      .order("title", { ascending: true })),
    // What "part of" can point at: everything still open on this site. The
    // same read the project screen uses, so the two lists cannot disagree.
    w.step("board", () => getBoard()),
  ]);
  w.done();

  const types = typeData ?? [];
  const trades = (tradeRows ?? []).map((t) => t.trade);
  const openTasks = board.tasks
    .filter((t) => t.project_id === id && t.state === "open")
    .map((t) => ({ id: t.id, label: t.action }));
  const contracts = (contractRows ?? []).map((c) => ({
    id: c.id,
    label: [c.title, c.trade].filter(Boolean).join(" · ") || "Contract",
  }));
  // portal_compose_targets groups people BY project, so the ones for this
  // site are one hop in - the same read and the same shape the task screen
  // uses for its assignee list.
  const people = (Array.isArray(peopleData) ? peopleData : [])
    .find((x) => x.project_id === id)?.people
    .map((p) => ({ contact_id: p.contact_id, name: p.name })) ?? [];

  return (
    <Screen>
      <AppBar back={to} title="New task" sub={projectRow?.project_name ?? undefined} />
      <div className="body">
        {error && <Notice kind="error" title="Not added.">{error}</Notice>}

        <div className="hero">
          <h1 style={{ fontSize: 22 }}>What needs doing?</h1>
          <p className="lead">
            A name is enough to get it on the board. Everything else — who holds it, when it is
            due, what it ends up costing — goes on afterwards.
          </p>
        </div>

        <form action={createTask.bind(null, id)} className="stack" style={{ gap: 14 }}>
          <input type="hidden" name="back" value={to} />
          <NewTaskForm projectId={id} types={types} people={people}
            payees={payeeData ?? []} trades={trades} contracts={contracts} openTasks={openTasks} />
        </form>
      </div>
    </Screen>
  );
}
