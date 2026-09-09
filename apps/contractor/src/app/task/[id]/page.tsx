import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { editTask, saveTask } from "./actions";
import { NoteBox } from "./NoteBox";
import { ChevronIcon } from "@shared/ui";
import type { Target } from "@shared/inbox/data";

export const dynamic = "force-dynamic";

// One task, opened from wherever you were, and returning there when you are
// done with it. portal_task_detail already carries the notes, the evidence,
// the assignee and the photo requirement, so this screen reads one function
// and posts to two - add_task_comment and portal_close_task.
type Detail = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; desired_outcome: string | null; notes: string | null;
  pending_on: string | null; pending_reason: string | null; pending_category: string | null;
  requires_photo_evidence: boolean | null;
  can_edit: boolean;
  created_at: string | null; created_by: string | null; last_updated: string | null;
  project_id: string | null; project: string | null;
  assignee: { id: string; name: string | null } | null;
  evidence: { id: string; file_name: string | null; kind: string | null; role: string | null }[];
  comments: { author: string | null; body: string | null; created_at: string | null }[];
  open_children: number;
};

// A note and what it carries (migration 037). Evidence hangs off the NOTE,
// not just the task, so the history reads as what someone said and showed.
type Note = {
  id: string; body: string | null; author: string | null; created_at: string | null;
  files: { file_id: string; path: string; kind: string | null; mime: string | null; name: string | null }[];
};

const CLOSED = ["Completed", "Cancelled", "Force Cancelled", "Superseded"];
const todayISO = () => new Date().toISOString().slice(0, 10);

// THE VOCABULARY IS THE DATABASE'S (rulebook 15). These are the open stages
// of actions_status_check - Completed and Cancelled are not here because
// closing goes through Mark complete, which records the why and the photo.
// Parked = you set it down; Pending on Others = you are blocked and the
// unblock comes from outside, so it needs a reason (help: actions).
const STAGES = ["Not Started", "In Progress", "Pending on Others", "Parked"] as const;
const PRIORITIES = ["Missing", "No Priority", "Low", "Medium", "High"] as const;
const PENDING_KINDS = [["", "—"], ["decision", "A decision"], ["delivery", "A delivery"], ["inspection", "An inspection"], ["legal", "Legal / permit"], ["financial", "Money"]] as const;

export default async function TaskPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ back?: string; error?: string; ok?: string; why?: string; edit?: string }>;
}) {
  const { id } = await params;
  const { back, error, ok, why, edit } = await searchParams;
  const to = back && back.startsWith("/") && !back.startsWith("//") ? back : "/tasks";

  const w = stopwatch("/task/[id]");
  const supabase = await createClient();
  const { data: claims } = await w.step("claims", () => supabase.auth.getClaims());
  if (!claims?.claims?.sub) redirect(`/login?next=${encodeURIComponent(`/task/${id}`)}`);
  // The detail and the notes leave together: portal_task_detail carries the
  // comments but not their ids, so there is nothing to hang evidence off -
  // portal_task_notes returns each note WITH what was attached to it.
  // The people on the project come from the same read the compose box
  // uses, so "assign to" offers exactly who a message could reach.
  const [{ data }, { data: noteData }, { data: targetData }] = await Promise.all([
    w.step("task", () => rpc<Detail>(supabase, "portal_task_detail", { p_task: id })),
    w.step("notes", () => rpc<Note[]>(supabase, "portal_task_notes", { p_action_id: id })),
    w.step("people", () => rpc<Target[]>(supabase, "portal_compose_targets")),
  ]);
  if (!data) notFound();

  const t = data;
  const notes = Array.isArray(noteData) ? noteData : [];
  const people = (Array.isArray(targetData) ? targetData : []).find((x) => x.project_id === t.project_id)?.people ?? [];
  // The current assignee may sit on a parent project rather than this one;
  // keep them in the list so the select does not silently drop them.
  if (t.assignee && !people.some((p) => p.contact_id === t.assignee!.id)) {
    people.unshift({ contact_id: t.assignee.id, name: t.assignee.name ?? "Assigned", seat: null });
  }
  // One signed-URL round trip for every attachment on the page.
  const notePaths = notes.flatMap((n) => n.files.map((f) => f.path));
  const noteUrls: Record<string, string> = {};
  if (notePaths.length > 0) {
    const { data: signed } = await w.step("noteFiles", () =>
      supabase.storage.from("project-media").createSignedUrls([...new Set(notePaths)], 3600));
    for (const row of signed ?? []) if (row.path && row.signedUrl) noteUrls[row.path] = row.signedUrl;
  }
  w.done();
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
        {ok && <div className="banner-ok">{ok}</div>}

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

        {/* EDIT THE TASK. Shahar: "i need a way to update the task ... who is
            it pending on, and stage. subject, comment." Everything the task
            IS, in one drawer: shut by default because most visits are to
            post an update, open when a save just failed so nothing typed is
            lost to a reload. Closing is not here - Mark complete is below. */}
        {!closed && t.can_edit && (
          <details className="home-panel" open={edit === "1"}>
            <summary className="home-row">
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">Edit the task</span>
                <span className="m" style={{ display: "block" }}>Subject, outcome, stage, who holds the ball, priority, date, assignee</span>
              </span>
              <span className="chev"><ChevronIcon /></span>
            </summary>
            <form action={editTask} className="drawer stack" style={{ gap: 10, paddingTop: 12 }}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="back" value={to} />
              <label className="field">
                <span className="field-label">Subject</span>
                <input className="input" name="action" defaultValue={t.action} required maxLength={300} />
              </label>
              <label className="field">
                <span className="field-label">Done looks like <span className="text-muted">(the end state, not the work)</span></span>
                <textarea className="input" name="desired_outcome" rows={2} defaultValue={t.desired_outcome ?? ""} />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <label className="field grow">
                  <span className="field-label">Stage</span>
                  <select className="input" name="status" defaultValue={STAGES.includes(t.status as typeof STAGES[number]) ? t.status : "Not Started"}>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="field grow">
                  <span className="field-label">Priority</span>
                  <select className="input" name="priority" defaultValue={t.priority ?? "Missing"}>
                    {PRIORITIES.map((p) => <option key={p} value={p}>{p === "Missing" ? "Not set" : p}</option>)}
                  </select>
                </label>
              </div>
              <label className="field">
                <span className="field-label">Pending on <span className="text-muted">(who or what holds the ball)</span></span>
                <input className="input" name="pending_on" defaultValue={t.pending_on ?? ""} placeholder="Steve at Andersen · the town inspector · a decision from Ifat" />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <label className="field grow">
                  <span className="field-label">Why <span className="text-muted">(required when Pending on Others)</span></span>
                  <input className="input" name="pending_reason" defaultValue={t.pending_reason ?? ""} placeholder="Waiting for the revised quote" />
                </label>
                <label className="field" style={{ flex: "0 0 40%" }}>
                  <span className="field-label">Kind</span>
                  <select className="input" name="pending_category" defaultValue={t.pending_category ?? ""}>
                    {PENDING_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
              </div>
              <div className="row" style={{ gap: 8 }}>
                <label className="field grow">
                  <span className="field-label">Due</span>
                  <input className="input" name="target_date" type="date" defaultValue={t.target_date ?? ""} />
                </label>
                <label className="field grow">
                  <span className="field-label">Assigned to</span>
                  <select className="input" name="assignee" defaultValue={t.assignee?.id ?? ""}>
                    <option value="">Nobody yet</option>
                    {people.map((p) => (
                      <option key={p.contact_id} value={p.contact_id}>{p.me ? `${p.name} (me)` : p.name}{p.seat ? ` · ${p.seat}` : ""}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button className="btn btn-primary btn-block">Save the task</button>
            </form>
          </details>
        )}

        {/* The update. One box, two outcomes - post it and keep the task
            open, or post it and close the task. */}
        {!closed && (
          <form action={saveTask} className="stack" style={{ gap: 10 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="back" value={to} />
            <div className="divider-label">Update, or mark complete</div>

            {needsWhy && (
              <label className="stack" style={{ gap: 4 }}>
                <span className="tiny text-muted">
                  No photo on this task yet. Closing without one records why, against the task.
                </span>
                <input name="reason" className="input" placeholder="Why there is no photo (a few words)" />
              </label>
            )}

            <NoteBox projectId={t.project_id} />
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
          <div className="divider-label">History · {notes.length}</div>
          {notes.length === 0 && (
            <Card soft pad><div className="small">Nothing posted on this task yet.</div></Card>
          )}
          {notes.map((c) => (
            <Card pad key={c.id} className="tight">
              <div className="tiny text-muted">
                {[c.author, c.created_at ? shortDate(c.created_at.slice(0, 10)) : null].filter(Boolean).join(" · ")}
              </div>
              {c.body && <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{c.body}</p>}
              {/* What was attached WITH this note. A recording plays here;
                  a photo shows; anything else is a named file. */}
              {c.files.length > 0 && (
                <div className="stack" style={{ gap: 8, marginTop: c.body ? 10 : 4 }}>
                  {c.files.map((f) => {
                    const url = noteUrls[f.path];
                    if (f.kind === "audio") {
                      return url
                        ? <audio key={f.file_id} src={url} controls preload="none" style={{ width: "100%" }} />
                        : <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>Voice note</p>;
                    }
                    if (f.kind === "photo") {
                      return url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img key={f.file_id} src={url} alt={f.name ?? "Photo"} style={{ width: "100%", borderRadius: 10, display: "block" }} />
                        : <div key={f.file_id} className="skel" style={{ aspectRatio: "4/3" }} />;
                    }
                    return (
                      <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>
                        {url ? <a href={url} target="_blank" rel="noreferrer">{f.name ?? f.kind}</a> : (f.name ?? f.kind)}
                      </p>
                    );
                  })}
                </div>
              )}
            </Card>
          ))}
        </section>
      </div>
    </Screen>
  );
}
