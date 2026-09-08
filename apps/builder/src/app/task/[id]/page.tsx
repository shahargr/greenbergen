import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { saveTask } from "./actions";

export const dynamic = "force-dynamic";

// One task, opened from wherever you were, and returning there when you are
// done with it. portal_task_detail already carries the notes, the evidence,
// the assignee and the photo requirement, so this screen reads one function
// and posts to two - add_task_comment and portal_close_task.
type Detail = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; desired_outcome: string | null; notes: string | null;
  pending_on: string | null; pending_reason: string | null;
  requires_photo_evidence: boolean | null;
  created_at: string | null; created_by: string | null; last_updated: string | null;
  project_id: string | null; project: string | null;
  assignee: { id: string; name: string | null } | null;
  evidence: { id: string; file_name: string | null; kind: string | null; role: string | null }[];
  comments: { author: string | null; body: string | null; created_at: string | null }[];
  open_children: number;
};

const CLOSED = ["Completed", "Cancelled", "Force Cancelled", "Superseded"];
const todayISO = () => new Date().toISOString().slice(0, 10);

export default async function TaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; error?: string; why?: string }>;
}) {
  const { id } = await params;
  const { back, error, why } = await searchParams;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : "/tasks";

  const w = stopwatch("/task/[id]");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/task/${id}`)}`);
  const { data } = await w.step("task", () => rpc<Detail>(supabase, "portal_task_detail", { p_task: id }));
  w.done();
  if (!data) notFound();

  const t = data;
  const closed = CLOSED.includes(t.status);
  const late = !!t.target_date && t.target_date < todayISO() && !closed;
  const photos = (t.evidence ?? []).filter((e) => e.kind === "photo");
  // portal_close_task asks for a reason whenever there is no photo on the
  // task - not only when the task is flagged as requiring one.
  const needsWhy = why === "1" || photos.length === 0;

  return (
    <Screen>
      <AppBar back={to} title="Task" sub={t.project ?? undefined} />
      <div className="body">
        {error && <Notice kind="error" title="Not saved.">{error}</Notice>}

        <div className="hero">
          <h1 style={{ fontSize: 24 }}>{t.action}</h1>
          <p className="lead">
            {[
              t.assignee?.name ?? "unassigned",
              t.priority && t.priority !== "Missing" ? `${t.priority} priority` : null,
              t.target_date ? `${late ? "was due" : "due"} ${shortDate(t.target_date)}` : "no date",
              closed ? t.status : null,
            ].filter(Boolean).join(" · ")}
          </p>
        </div>

        {t.project_id && (
          <p className="small text-muted" style={{ margin: "-4px 0 0" }}>
            On <Link href={`/project/${t.project_id}`}>{t.project}</Link>.
          </p>
        )}

        {(t.desired_outcome || t.notes) && (
          <Card soft pad>
            {t.desired_outcome && <><div className="kicker">Done looks like</div>
              <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{t.desired_outcome}</p></>}
            {t.notes && <p className="small" style={{ margin: t.desired_outcome ? "10px 0 0" : 0, whiteSpace: "pre-wrap" }}>{t.notes}</p>}
          </Card>
        )}

        {t.open_children > 0 && (
          <Notice kind="info" title={`${t.open_children} step${t.open_children === 1 ? "" : "s"} still open beneath this.`}>
            Those close first — the database blocks a parent while a gate child is open.
          </Notice>
        )}

        {t.pending_on && (
          <Notice kind="info" title={`Waiting on ${t.pending_on}.`}>{t.pending_reason ?? "No reason recorded."}</Notice>
        )}

        {/* The update. One box, two outcomes - post it and keep the task
            open, or post it and close the task. */}
        {!closed && (
          <form action={saveTask} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="back" value={to} />
            <div className="divider-label">Update, or mark complete</div>
            <textarea name="note" rows={4} className="input" placeholder="What happened, what is next, what is blocked…" />

            {needsWhy && (
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny text-muted">
                  No photo on this task yet. Closing without one records why, against the task.
                </span>
                <input name="reason" className="input" placeholder="Why there is no photo (a few words)" />
              </label>
            )}

            <button type="submit" name="complete" value="0" className="btn btn-primary btn-block">Post update</button>
            <button type="submit" name="complete" value="1" className="btn btn-secondary btn-block">Mark complete</button>
          </form>
        )}

        {closed && (
          <Card soft pad><div className="small">This task is {t.status.toLowerCase()}. Reopening is a portal action.</div></Card>
        )}

        {photos.length > 0 && (
          <p className="tiny text-muted" style={{ margin: 0 }}>
            {photos.length} photo{photos.length === 1 ? "" : "s"} on file.
          </p>
        )}

        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">History · {t.comments?.length ?? 0}</div>
          {(t.comments ?? []).length === 0 && (
            <Card soft pad><div className="small">Nothing posted on this task yet.</div></Card>
          )}
          {(t.comments ?? []).map((c, i) => (
            <Card pad key={i} className="tight">
              <div className="tiny text-muted">
                {[c.author, c.created_at ? shortDate(c.created_at.slice(0, 10)) : null].filter(Boolean).join(" · ")}
              </div>
              <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.body}</p>
            </Card>
          ))}
        </section>
      </div>
    </Screen>
  );
}
