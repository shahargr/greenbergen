"use client";

import { useState } from "react";
import { saveTask, completeTask, setTaskStatus, uploadEvidence, addComment, addContractor, type TaskPerms } from "./actions";
import { VoiceRecorder } from "@/components/VoiceRecorder";

export type TaskView = {
  id: string;
  action: string;
  status: string;
  priority: string | null;
  target_date: string | null;
  desired_outcome: string | null;
  notes: string | null;
  dependencies: string | null;
  learnings: string | null;
  pending_on: string | null;
  pending_reason: string | null;
  requires_photo_evidence: boolean;
  is_gate: boolean;
  cadence: string | null;
  created_at: string;
  created_by: string | null;
  source: string | null;
  projectName: string | null;
  assignedToName: string | null;
  assignedByName: string | null;
  assignedToContactId: string | null;
};

export type MemberOption = { contactId: string; name: string };
export type CommentView = { id: string; author_name: string; body: string; created_at: string };

const OPEN_STATUSES = ["Not Started", "In Progress", "Pending on Others", "Parked"];
const PRIORITIES = ["No Priority", "Low", "Medium", "High"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="task-row">
      <span className="task-label">{label}</span>
      <span className="task-value">{children}</span>
    </div>
  );
}

// Locked by default: every field visible, nothing editable until Unlock.
// What unlocks is decided server-side (perms) and enforced again on save.
// Evidence (multiple photos + a voice note) uploads separately from the act
// of flagging complete.
export function TaskEditor({
  task,
  perms,
  members,
  comments,
  isOpen,
  evidenceCount,
}: {
  task: TaskView;
  perms: TaskPerms;
  members: MemberOption[];
  comments: CommentView[];
  isOpen: boolean;
  evidenceCount: number;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [status, setStatus] = useState(task.status);
  const [quick, setQuick] = useState<"none" | "photo" | "audio" | "comment">("none");
  const [moveTo, setMoveTo] = useState(task.status);
  const [closeReason, setCloseReason] = useState("");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busyEvidence, setBusyEvidence] = useState(false);

  async function submitPhotos(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.querySelector<HTMLInputElement>('input[name="photos"]');
    const fd = new FormData();
    for (const f of Array.from(input?.files ?? [])) fd.append("files", f);
    if (![...fd.keys()].length) return;
    setBusyEvidence(true);
    await uploadEvidence(task.id, fd);
  }

  async function submitVoice() {
    if (!voiceBlob) return;
    const fd = new FormData();
    const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
    fd.append("files", new File([voiceBlob], `voice-note.${ext}`, { type: voiceBlob.type }));
    setBusyEvidence(true);
    await uploadEvidence(task.id, fd);
  }

  async function applyMove() {
    const fd = new FormData();
    setBusyEvidence(true);
    if (moveTo === "Completed") {
      if (closeReason.trim()) fd.append("reason", closeReason.trim());
      await completeTask(task.id, fd);
    } else {
      fd.append("status", moveTo);
      await setTaskStatus(task.id, fd);
    }
  }

  const canEditAnything =
    perms.title || perms.status || perms.outcome || perms.notes ||
    perms.dependencies || perms.learnings || perms.assign;

  const pendingSelected = status.includes("Pending");

  // The dropdown offers what the matrix allows: PM and above move a task
  // anywhere; a plain assignee can only take it to Completed.
  const OPEN = ["Not Started", "In Progress", "Pending on Others", "Parked"];
  const statusChoices = perms.status
    ? [...new Set([...OPEN, task.status, "Completed", "Cancelled"])].sort((a, b) => {
        const rank = (st: string) =>
          st === "Completed" ? OPEN.length : st === "Cancelled" ? OPEN.length + 1 : Math.max(OPEN.indexOf(st), 0);
        return rank(a) - rank(b);
      })
    : [...new Set([task.status, "Completed"])];

  const canAttach = isOpen && (perms.notes || perms.complete);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {isOpen && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div className="btn-row">
            {canAttach && (
              <button type="button" className={quick === "photo" ? "btn" : "btn ghost"} onClick={() => setQuick(quick === "photo" ? "none" : "photo")}>
                📷 Add photo
              </button>
            )}
            {canAttach && (
              <button type="button" className={quick === "audio" ? "btn" : "btn ghost"} onClick={() => setQuick(quick === "audio" ? "none" : "audio")}>
                🎙 Record audio
              </button>
            )}
            <button type="button" className={quick === "comment" ? "btn" : "btn ghost"} onClick={() => setQuick(quick === "comment" ? "none" : "comment")}>
              💬 Add comment
            </button>
            <span className="muted small" style={{ alignSelf: "center" }}>
              {evidenceCount > 0 ? `${evidenceCount} file${evidenceCount > 1 ? "s" : ""} attached` : ""}
            </span>
          </div>

          {quick === "photo" && (
            <form onSubmit={submitPhotos} style={{ display: "grid", gap: 8 }}>
              <input type="file" name="photos" accept="image/*" capture="environment" multiple className="small" />
              <div className="btn-row">
                <button className="btn" disabled={busyEvidence}>{busyEvidence ? "Uploading..." : "Upload"}</button>
              </div>
            </form>
          )}

          {quick === "audio" && (
            <div style={{ display: "grid", gap: 8 }}>
              <VoiceRecorder onReady={setVoiceBlob} />
              <div className="btn-row">
                <button type="button" className="btn" disabled={!voiceBlob || busyEvidence} onClick={submitVoice}>
                  {busyEvidence ? "Saving..." : "Save recording"}
                </button>
              </div>
            </div>
          )}

          {quick === "comment" && (
            <form action={addComment.bind(null, task.id)} style={{ display: "grid", gap: 8 }}>
              <textarea name="body" className="input" rows={2} required placeholder="Add a comment — no unlock needed" />
              <div className="btn-row">
                <button className="btn">Post comment</button>
              </div>
            </form>
          )}
        </div>
      )}

      {comments.length > 0 && (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Comments · {comments.length}</h2>
          {comments.map((c) => (
            <div key={c.id} className="small" style={{ borderLeft: "3px solid var(--brand, #1f6b45)", paddingLeft: 10 }}>
              <span className="muted">
                <strong style={{ color: "inherit" }}>{c.author_name}</strong>
                {" · "}
                {new Date(c.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <div style={{ whiteSpace: "pre-line" }}>{c.body}</div>
            </div>
          ))}
        </div>
      )}

      <form action={saveTask.bind(null, task.id)} className="card" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Task</h2>
          {isOpen && canEditAnything && !unlocked && (
            <button type="button" className="btn ghost" style={{ padding: "6px 12px" }}
              onClick={() => setUnlocked(true)}>
              🔒 Unlock to edit
            </button>
          )}
          {unlocked && <span className="small" style={{ color: "var(--brand)" }}>Unlocked — editing</span>}
        </div>

        <Row label="Title">
          {unlocked && perms.title ? (
            <input name="title" className="input" defaultValue={task.action} required />
          ) : (
            <strong>{task.action}</strong>
          )}
        </Row>

        <Row label="Status">
          {unlocked && perms.status ? (
            <span style={{ display: "grid", gap: 4 }}>
              <select name="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)} style={{ maxWidth: 220 }}>
                {[...OPEN_STATUSES, "Completed", "Cancelled"].map((s) => <option key={s}>{s}</option>)}
              </select>
              {status === "Completed" && (
                <span className="muted small">
                  Saving will close this task — it needs attached evidence
                  (or use the completion card below to close with a reason).
                </span>
              )}
              {status === "Cancelled" && (
                <span className="muted small">
                  Saving will cancel this task for good. Open subtasks must be
                  closed first; no evidence needed.
                </span>
              )}
            </span>
          ) : (
            task.status
          )}
        </Row>

        {pendingSelected && (
          <>
            <Row label="Waiting on">
              {unlocked && perms.notes ? (
                <input name="pending_on" className="input" defaultValue={task.pending_on ?? ""} placeholder="Who are we waiting on?" />
              ) : (
                task.pending_on ?? "—"
              )}
            </Row>
            <Row label="Why pending">
              {unlocked && perms.notes ? (
                <input name="pending_reason" className="input" defaultValue={task.pending_reason ?? ""} placeholder="Required while pending" />
              ) : (
                task.pending_reason ?? "—"
              )}
            </Row>
          </>
        )}

        <Row label="Priority">
          {unlocked && perms.status ? (
            <select name="priority" className="input" defaultValue={task.priority ?? "No Priority"} style={{ maxWidth: 220 }}>
              {PRIORITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
          ) : (
            task.priority ?? "—"
          )}
        </Row>

        <Row label="Target date">
          {unlocked && perms.status ? (
            <input name="target_date" type="date" className="input" defaultValue={task.target_date ?? ""} style={{ maxWidth: 220 }} />
          ) : (
            task.target_date ?? "—"
          )}
        </Row>

        <Row label="Desired outcome">
          {unlocked && perms.outcome ? (
            <textarea name="desired_outcome" className="input" rows={2} defaultValue={task.desired_outcome ?? ""} />
          ) : (
            task.desired_outcome ?? "—"
          )}
        </Row>

        <Row label="Notes">
          {unlocked && perms.notes ? (
            <textarea name="notes" className="input" rows={4} defaultValue={task.notes ?? ""} />
          ) : (
            <span style={{ whiteSpace: "pre-line" }}>{task.notes ?? "—"}</span>
          )}
        </Row>

        {perms.dependencies && (
          <Row label="Dependencies">
            {unlocked ? (
              <textarea name="dependencies" className="input" rows={2} defaultValue={task.dependencies ?? ""} />
            ) : (
              task.dependencies ?? "—"
            )}
          </Row>
        )}

        {perms.learnings && (
          <Row label="Learnings (admin)">
            {unlocked ? (
              <textarea name="learnings" className="input" rows={2} defaultValue={task.learnings ?? ""} />
            ) : (
              task.learnings ?? "—"
            )}
          </Row>
        )}

        <Row label="Assigned to">
          {unlocked && perms.assign ? (
            <span style={{ display: "grid", gap: 8 }}>
              <select name="assigned_to" className="input" defaultValue={task.assignedToContactId ?? ""} style={{ maxWidth: 260 }}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.contactId} value={m.contactId}>{m.name}</option>
                ))}
              </select>
              <details>
                <summary className="muted small" style={{ cursor: "pointer" }}>
                  Not on the project yet? Add a contractor
                </summary>
                <span style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  <input name="nc_name" className="input" placeholder="Name (required)" />
                  <input name="nc_email" type="email" className="input" placeholder="Email (optional)" />
                  <input name="nc_phone" type="tel" className="input" placeholder="Phone (optional)" />
                  <span>
                    <button className="btn ghost" formAction={addContractor.bind(null, task.id)} formNoValidate>
                      ＋ Add to project &amp; assign
                    </button>
                  </span>
                </span>
              </details>
            </span>
          ) : (
            task.assignedToName ?? "Unassigned"
          )}
        </Row>

        <Row label="Project">{task.projectName ?? "—"}</Row>
        <Row label="Assigned by">{task.assignedByName ?? "—"}</Row>
        <Row label="Created">
          {new Date(task.created_at).toLocaleDateString()} {task.created_by ? `by ${task.created_by}` : ""}
          {task.source ? ` · via ${task.source}` : ""}
        </Row>
        {(task.is_gate || task.requires_photo_evidence || (task.cadence && task.cadence !== "one-time")) && (
          <Row label="Flags">
            <span style={{ display: "inline-flex", gap: 8, flexWrap: "wrap" }}>
              {task.is_gate && <span className="extra-chip">gate</span>}
              {task.requires_photo_evidence && <span className="extra-chip">photo required</span>}
              {task.cadence && task.cadence !== "one-time" && <span className="extra-chip">{task.cadence}</span>}
            </span>
          </Row>
        )}

        {unlocked && (
          <div className="btn-row">
            <button className="btn">Save changes</button>
            <button type="button" className="btn ghost" onClick={() => setUnlocked(false)}>Cancel</button>
          </div>
        )}
      </form>

      {isOpen && perms.complete && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Evidence &amp; completion</h2>
            <span className="muted small">
              {evidenceCount > 0 ? `${evidenceCount} file${evidenceCount > 1 ? "s" : ""} attached` : "No evidence yet"}
            </span>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="te-move">Move this task to</label>
                <div className="btn-row">
                  <select
                    id="te-move"
                    className="input"
                    value={moveTo}
                    onChange={(e) => setMoveTo(e.target.value)}
                    style={{ maxWidth: 230 }}
                  >
                    {statusChoices.map((st) => <option key={st}>{st}</option>)}
                  </select>
                  <button
                    type="button"
                    className="btn"
                    disabled={moveTo === task.status || busyEvidence}
                    onClick={applyMove}
                  >
                    {busyEvidence ? "Applying..." : "Apply"}
                  </button>
                </div>
              </div>
              {moveTo === "Cancelled" && (
                <p className="muted small" style={{ margin: 0 }}>
                  Cancelling closes this task for good — open subtasks must be
                  closed first. No evidence needed.
                </p>
              )}
              {moveTo === "Completed" && (
                <div style={{ display: "grid", gap: 8 }}>
                  <p className="muted small" style={{ margin: 0 }}>
                    {task.requires_photo_evidence
                      ? "This task requires an AFTER photo attached as evidence before it can close."
                      : evidenceCount > 0
                        ? "Evidence is attached — Apply closes the task; add a note if you like."
                        : "No evidence attached: add photos or audio up top, or write a short reason for closing without it."}
                  </p>
                  <textarea
                    className="input"
                    rows={2}
                    value={closeReason}
                    onChange={(e) => setCloseReason(e.target.value)}
                    placeholder={evidenceCount > 0 ? "Closing note (optional)" : "Reason for closing without evidence"}
                  />
                </div>
              )}
            </div>

        </div>
      )}
    </div>
  );
}
