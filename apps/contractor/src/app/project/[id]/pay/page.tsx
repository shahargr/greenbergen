import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { getBoard, money, readMoney, type TaskMoney } from "@/lib/board";
import { PaymentBox, type Method } from "../../../task/[id]/PaymentBox";
import { logCategoryPayment } from "./actions";
import type { Target } from "@shared/inbox/data";

export const dynamic = "force-dynamic";

// A PAYMENT, UNDER THE CATEGORY IT BELONGS TO.
//
// Shahar (2026-09-13): "under each category allow me to log a payment."
//
// The category is the context, never the owner: money is filed against a
// TASK, because that is where the money ladder gates it, where the receipt
// lives and where anybody looking for it later will go. So this screen does
// one thing the task screen cannot - it starts from "this is a framing cost"
// and shortlists the framing work, with whatever is already outstanding on
// each one shown, so the receipt you are holding finds its row in one tap.
//
// No new read: getBoard() already carries every task with its trade and
// phase (portal_tasks), portal_task_money carries what each one owes
// (migration 078), and the two say the same thing here as on the project
// screen you came from.
export default async function CategoryPayPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ trade?: string; phase?: string; owner?: string; untagged?: string; back?: string; error?: string; task?: string }>;
}) {
  const { id } = await params;
  const { trade, phase, owner, untagged, back, error, task } = await searchParams;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : `/project/${id}`;

  const w = stopwatch("/project/[id]/pay");
  const supabase = await createClient();
  const [board, { data: moneyData }, { data: targetData }, { data: acctData }, { data: methodData }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("money", () => rpc<TaskMoney>(supabase, "portal_task_money", { p_project: id })),
    w.step("people", () => rpc<Target[]>(supabase, "portal_compose_targets")),
    w.step("accounts", () => rpc<string[]>(supabase, "portal_payment_accounts", { p_project: id })),
    // The rails a payment can be recorded on. The same list the task screen
    // gets from portal_task_detail: active, and settled by hand.
    // await, not the builder itself: a PostgREST builder is thenable but not
    // a Promise, and Promise.all types it as unknown.
    w.step("methods", async () => await supabase.from("payment_methods")
      .select("id, name, requires_reference")
      .eq("is_active", true).eq("settlement_type", "manual")
      .order("display_order", { ascending: true, nullsFirst: false })),
  ]);
  if (!board.signed_in) redirect(`/login?next=/project/${id}/pay`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();

  const taskMoney = readMoney(moneyData);
  if (!taskMoney.can_log) {
    return (
      <Screen>
        <AppBar back={to} title="Log a payment" sub={seat.project_name} />
        <div className="body">
          <Notice title="Money is not yours to record on this site.">
            Ask whoever runs it to give you financial access, or post what you spent as an update
            on the task instead.
          </Notice>
        </div>
      </Screen>
    );
  }

  // Everything at or beneath this project, the same family the project screen
  // and the trade screen use - the work lives on the jobs, not the container.
  const family = new Set<string>([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const s of board.seats) {
      if (s.parent_project_id && family.has(s.parent_project_id) && !family.has(s.project_id)) {
        family.add(s.project_id); grew = true;
      }
    }
  }

  // WHICH CATEGORY. Untagged is a category too - on 55 Walnut it holds most
  // of the receipts, so hiding it would hide the work (see groupWork).
  const label = owner ? `${owner}'s work`
    : untagged === "1" ? "work with no trade recorded"
    : (trade ?? phase ?? "this site");
  const inCategory = board.tasks.filter((t) => {
    if (t.state !== "open" || !t.project_id || !family.has(t.project_id)) return false;
    // An owner category is what no trade claimed, held by one person - the
    // same rule groupWork files it under (Shahar, 2026-09-13: "anything you
    // don't know club under the owner").
    if (owner) return !t.trade && (t.assignee ?? "Nobody yet") === owner;
    if (trade) return t.trade === trade;
    if (phase) return t.phase === phase;
    if (untagged === "1") return !t.trade;
    return true;
  });

  // What is owed first - the receipt you are holding is almost always one of
  // these - then the rest, soonest first.
  const owedOf = (tid: string) => taskMoney.tasks[tid]?.owed ?? 0;
  const choices = [...inCategory].sort((a, b) =>
    owedOf(b.id) - owedOf(a.id) ||
    (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") ||
    a.action.localeCompare(b.action));

  const people = (Array.isArray(targetData) ? targetData : []).find((x) => x.project_id === id)?.people
    ?? (Array.isArray(targetData) ? targetData : []).flatMap((x) => x.people);
  const accounts = Array.isArray(acctData) ? acctData : [];
  const methods = (methodData ?? []) as Method[];
  const nameOf = new Map(board.seats.map((s) => [s.project_id, s.project_name]));
  const here = `/project/${id}/pay?${new URLSearchParams({
    ...(trade ? { trade } : {}), ...(phase ? { phase } : {}), ...(owner ? { owner } : {}),
    ...(untagged ? { untagged } : {}), back: to,
  }).toString()}`;
  w.done();

  return (
    <Screen>
      <AppBar back={to} title="Log a payment" sub={seat.project_name} />
      <div className="body">
        {error && <Notice kind="error" title="Not saved.">{error}</Notice>}

        <div className="hero">
          <h1 style={{ fontSize: 22 }}>What did you pay for in {label}?</h1>
          <p className="lead">
            {choices.length === 0
              ? "Nothing is open under this category yet."
              : `${choices.length} open ${choices.length === 1 ? "task" : "tasks"} — the payment is filed against the one it belongs to.`}
          </p>
        </div>

        {choices.length === 0 && (
          <Card soft pad>
            <div className="small">
              A payment is filed against a task, so there has to be one to file it against.
              Open the job, add the task, then log what it cost.
            </div>
            <Link href={to} className="btn btn-ghost btn-block" style={{ marginTop: 10 }}>Go back</Link>
          </Card>
        )}

        {choices.length > 0 && (
          <form action={logCategoryPayment} className="stack" style={{ gap: 12 }}>
            <input type="hidden" name="back" value={to} />
            <input type="hidden" name="here" value={here} />

            <label className="field">
              <span className="field-label">Which task</span>
              <select className="input" name="action_id" required defaultValue={task ?? ""}>
                <option value="" disabled>Choose the task this belongs to…</option>
                {choices.map((t) => {
                  const owed = owedOf(t.id);
                  const on = t.project_id && t.project_id !== id ? nameOf.get(t.project_id) ?? t.project : null;
                  return (
                    <option key={t.id} value={t.id}>
                      {t.action}
                      {owed > 0 ? ` — ${money(owed)} to pay` : ""}
                      {on ? ` · ${on}` : ""}
                      {t.target_date ? ` · due ${shortDate(t.target_date)}` : ""}
                    </option>
                  );
                })}
              </select>
              <span className="hint">
                Anything already outstanding is at the top of the list. Nothing here fits?
                Open the job and add the task first — a payment with no task is a payment
                nobody can find again.
              </span>
            </label>

            <PaymentBox projectId={id} methods={methods} accounts={accounts}
              people={people.map((x) => ({ contact_id: x.contact_id, name: x.name }))} />

            <Link href={to} className="btn btn-ghost btn-block">Cancel</Link>
          </form>
        )}
      </div>
    </Screen>
  );
}
