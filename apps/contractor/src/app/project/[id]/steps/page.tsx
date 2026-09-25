import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDay } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import { answerStep } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Step by step" };

// ONE STEP AT A TIME.
//
// Shahar (2026-09-22), walking Ran's DIY generator end to end - permit data,
// papers and diagrams, submit, approve, purchase, schedule, phase one,
// inspection, phase two, inspection, close the permit: "For all this we need
// step by step ui."
//
// EVERYTHING BEHIND THIS SCREEN ALREADY EXISTED. The fifteen steps are real
// tasks on the job carrying asks, decides, answers, only_if, is_gate, trade
// and kind; portal_step_answer records an answer, cancels what that answer
// rules out and closes the step; close_action keeps the gates. What was
// missing was a screen that says THIS ONE, NOW - and the board could not say
// it, because a board shows you everything and the whole point of a process
// is that most of it is not your problem yet.
//
// THE SHAPE IS ONE BIG CARD AND A LIST. The big card is the only step you can
// act on. The list underneath is the map: what is done, what is ruled out,
// and what is waiting - on the GATE BY NAME, because "you cannot do this yet"
// is useless and "not until the town approves the permits" is a fact.
//
// ANSWERING HAPPENS HERE; CLOSING DOES NOT. A step that asks a question is
// answered and closed in one press. A step that is WORK - set the pad, run
// the gas - opens its task, where closing already knows about photographs,
// gates and evidence. Reimplementing that here would be a second set of
// rules to drift (rulebook 30).

type Step = {
  id: string; n: number; action: string; notes: string | null;
  asks: string | null; answer: string | null; decides: string | null; answers: string[] | null;
  only_if: Record<string, string> | null; is_gate: boolean; trade: string | null;
  kind: string | null; status: string; due: string | null; who: string | null;
  files: number; done: boolean; off: boolean; blocked: boolean;
};
type Run = {
  process: string | null; parent_id: string | null;
  total: number; done: number; off: number;
  blocked_by: string | null; now: string | null; steps: Step[];
};

export default async function StepsPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { id } = await params;
  const { ok, error } = await searchParams;

  const w = stopwatch("/project/[id]/steps");
  const supabase = await createClient();
  const [board, { data }, { data: mayEdit }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("steps", () => rpc<Run>(supabase, "portal_project_steps", { p_project: id })),
    w.step("mayEdit", () => rpc<boolean>(supabase, "can_edit_project", { p_project_id: id })),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/steps`)}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  w.done();

  const run = data ?? null;
  const canEdit = mayEdit === true;
  const back = `/project/${id}`;

  if (!run || !run.parent_id) {
    return (
      <Screen>
        <AppBar back={back} title="Step by step" sub={seat.project_name} />
        <div className="body">
          <Card soft pad>
            <div className="card-title">This job has no process.</div>
            <p className="small text-muted" style={{ margin: "6px 0 0" }}>
              A process comes from the package a job was taken from. This one names no package, so
              there is nothing to walk — the board is the whole picture here.
            </p>
            <Link href={back} className="btn btn-ghost btn-block" style={{ marginTop: 10 }}>Go back</Link>
          </Card>
        </div>
      </Screen>
    );
  }

  const now = run.steps.find((s) => s.id === run.now) ?? null;
  const left = run.total - run.done;

  return (
    <Screen>
      <AppBar back={back} title="Step by step" sub={run.process ?? seat.project_name} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error" title="Not saved.">{error}</Notice>}

        <div className="hero">
          <h1>{run.done} of {run.total}</h1>
          <p className="lead">
            {left === 0
              ? "Every step is done."
              : now
                ? `${left} to go. This is the one you can do now.`
                : `${left} to go — and none of them can start until ${run.blocked_by ?? "what is above them"} is closed.`}
            {run.off > 0 ? ` ${run.off} ruled out along the way.` : ""}
          </p>
        </div>

        {/* ── THE ONE YOU CAN DO NOW ── */}
        {now && (
          <Card pad>
            <div className="kicker">
              Step {now.n}
              {now.trade ? ` · ${now.trade}` : ""}
              {now.is_gate ? " · everything waits on this" : ""}
            </div>
            <h2 style={{ fontSize: 19, margin: "4px 0 0" }}>{now.action}</h2>

            {/* THE GUIDANCE IS THE POINT. These notes are the best-written
                thing in the database - why the gas comes before the electric,
                why the generator is not ordered until the permits are in -
                and on the board they are three taps down. Here they are the
                screen. */}
            {now.notes && (
              <p className="small" style={{ whiteSpace: "pre-wrap", margin: "10px 0 0" }}>{now.notes}</p>
            )}

            {now.asks ? (
              <form action={answerStep.bind(null, id)} className="stack" style={{ gap: 8, marginTop: 12 }}>
                <input type="hidden" name="action_id" value={now.id} />
                <div className="field">
                  <span className="field-label">{now.asks} <span className="req">required</span></span>
                  {/* A step with a fixed set of answers is a DECISION, and a
                      decision drives what happens next - answering it "no"
                      can call a whole branch off. So it is buttons, not a
                      box somebody can mistype. */}
                  {now.answers && now.answers.length > 0 ? (
                    <div className="seg" role="radiogroup" aria-label={now.asks}>
                      {now.answers.map((a) => (
                        <label className="seg-opt" key={a}>
                          <input type="radio" name="answer" value={a} required />
                          <span>{a}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <input className="input" name="answer" required
                      placeholder="What the answer turned out to be" />
                  )}
                </div>
                <label className="field">
                  <span className="field-label">Anything worth keeping with it</span>
                  <input className="input" name="note" placeholder="Optional" />
                </label>
                {canEdit && (
                  <button className="btn btn-primary btn-block">
                    {now.answers && now.answers.length > 0 ? "Record it and move on" : "Answer and close this step"}
                  </button>
                )}
              </form>
            ) : (
              <div className="stack" style={{ gap: 8, marginTop: 12 }}>
                <p className="tiny text-muted" style={{ margin: 0 }}>
                  This one is work rather than a question. Open it to log what happened, attach the
                  photographs and close it — closing knows about the evidence this step needs.
                </p>
                <Link href={`/task/${now.id}?back=${encodeURIComponent(`/project/${id}/steps`)}`}
                  className="btn btn-primary btn-block">
                  Open the step
                </Link>
              </div>
            )}
          </Card>
        )}

        {/* Nothing to do, and a reason why. */}
        {!now && left > 0 && (
          <Notice kind="info" title={`Waiting on ${run.blocked_by ?? "a gate above"}.`}>
            Nothing below it can start until it closes. That is the process doing its job — a
            generator ordered before the permits are approved is the most expensive way to get
            this wrong.
          </Notice>
        )}

        {/* ── THE WHOLE RUN ── */}
        <section className="stack" style={{ gap: 6 }}>
          <div className="divider-label">The whole job · {run.total} steps</div>
          {run.steps.map((s) => {
            const isNow = s.id === run.now;
            const mark = s.off ? "—" : s.done ? "✓" : isNow ? "●" : "○";
            const tone = s.off ? "var(--muted)"
              : s.done ? "var(--color-ok)"
              : isNow ? "var(--color-accent)" : "var(--muted)";
            return (
              <Link href={`/task/${s.id}?back=${encodeURIComponent(`/project/${id}/steps`)}`}
                className="home-row" key={s.id} style={{ opacity: s.off ? 0.55 : 1 }}>
                <span style={{ color: tone, flex: "none", width: 18, textAlign: "center" }}>{mark}</span>
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t" style={{ textDecoration: s.off ? "line-through" : undefined }}>
                    {s.action}
                  </span>
                  <span className="m" style={{ display: "block" }}>
                    {s.off ? "Ruled out"
                      : s.done ? (s.answer ? `Answered: ${s.answer}` : "Done")
                      : s.blocked ? `Waiting on ${run.blocked_by}`
                      : isNow ? "You can do this now"
                      : "Next up"}
                    {s.trade ? ` · ${s.trade}` : ""}
                    {s.is_gate && !s.done && !s.off ? " · gate" : ""}
                    {s.due ? ` · ${shortDay(s.due)}` : ""}
                  </span>
                </span>
              </Link>
            );
          })}
        </section>

        <Link href={back} className="small" style={{ alignSelf: "flex-start" }}>← Back to the job</Link>
      </div>
    </Screen>
  );
}
