import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { saveTask } from "./actions";
import { NoteBox } from "./NoteBox";

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

// A note and what it carries (migration 037). Evidence hangs off the NOTE,
// not just the task, so the history reads as what someone said and showed.
type Note = {
  id: string; body: string | null; author: string | null; created_at: string | null;
  files: { file_id: string; path: string; kind: string | null; mime: string | null; name: string | null }[];
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
  // The detail and the notes leave together: portal_task_detail carries the
  // comments but not their ids, so there is nothing to hang evidence off -
  // portal_task_notes returns each note WITH what was attached to it.
  const [{ data }, { data: noteData }] = await Promise.all([
    w.step("task", () => rpc<Detail>(supabase, "portal_task_detail", { p_task: id })),
    w.step("notes", () => rpc<Note[]>(supabase, "portal_task_notes", { p_action_id: id })),
  ]);
  if (!data) notFound();

  const t = data;
  const notes = Array.isArray(noteData) ? noteData : [];
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
