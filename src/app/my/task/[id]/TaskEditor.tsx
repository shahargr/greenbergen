"use client";

import { useState } from "react";
import { saveTask, completeTask, setTaskStatus, uploadEvidence, addComment, addContractor, type TaskPerms } from "./actions";
import { VoiceRecorder } from "@/components/VoiceRecorder";
import { FileDrop } from "@/components/FileDrop";

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

export type MemberOption = { contactId: string; name: string; trade?: string | null };
export type CommentView = { id: string; author_name: string; body: string; created_at: string };

const PRIORITIES = ["No Priority", "Low", "Medium", "High"];

// A long body (notes, learnings) shows at most four lines and scrolls
// inside its own box, so one wordy field cannot push the page apart.
function LongText({ value }: { value: string | null | undefined }) {
  if (!value) return <>—</>;
  return (
    <span style={{ display: "block", whiteSpace: "pre-line", maxHeight: "5.8em", overflowY: "auto", overscrollBehavior: "contain" }}>
      {value}
    </span>
  );
}

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
  trades = [],
  isOpen,
  evidenceCount,
  evidenceSlot,
  parentName = null,
  childCount = 0,
}: {
  task: TaskView;
  perms: TaskPerms;
  members: MemberOption[];
  comments: CommentView[];
  trades?: string[];
  isOpen: boolean;
  evidenceCount: number;
  // The evidence gallery, rendered by the page; sits right under the
  // comment / photo / audio card.
  evidenceSlot?: React.ReactNode;
  // Parent / child facts for the header badge.
  parentName?: string | null;
  childCount?: number;
}) {
  const [unlocked, setUnlocked] = useState(false);
  const [quick, setQuick] = useState<"none" | "photo" | "audio" | "comment">("none");
  const [moveTo, setMoveTo] = useState(task.status);
  const [closeReason, setCloseReason] = useState("");
  // A comment rides along with a stage move; mandatory for Pending on Others.
  const [moveComment, setMoveComment] = useState("");
  const [pendingOn, setPendingOn] = useState(task.pending_on ?? "");
  // Close-and-chain: name the next task and it is created as a follow-up
  // (a sibling that follows this one, never a child that would block the close).
  const [followUp, setFollowUp] = useState("");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [busyEvidence, setBusyEvidence] = useState(false);
  const [busyMove, setBusyMove] = useState(false);
  const [uploadFailed, setUploadFailed] = useState("");
  // Drag-drop / paste / multi-file staging now lives in the shared FileDrop;
  // its hidden carrier input (name="photos") holds everything to upload.

  // Upload and Move are independent actions with independent busy states -
  // sharing one flag made the Apply button show "Applying..." and stay
  // disabled after a photo upload, so a task could never be moved on.
  async function guarded(setBusy: (b: boolean) => void, run: () => Promise<void>) {
    setBusy(true);
    setUploadFailed("");
    try {
      await run();
    } catch (err) {
      if (err && typeof err === "object" && "digest" in err && String(err.digest).startsWith("NEXT_REDIRECT")) throw err;
      setBusy(false);
      setUploadFailed(err instanceof Error ? err.message : "Failed — try smaller files.");
    }
  }

  async function submitPhotos(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const input = e.currentTarget.querySelector<HTMLInputElement>('input[name="photos"]');
    const fd = new FormData();
    for (const f of Array.from(input?.files ?? [])) fd.append("files", f);
    if (![...fd.keys()].length) return;
    await guarded(setBusyEvidence, () => uploadEvidence(task.id, fd));
  }

  async function submitVoice() {
    if (!voiceBlob) return;
    const fd = new FormData();
    const ext = voiceBlob.type.includes("mp4") ? "m4a" : "webm";
    fd.append("files", new File([voiceBlob], `voice-note.${ext}`, { type: voiceBlob.type }));
    await guarded(setBusyEvidence, () => uploadEvidence(task.id, fd));
  }

  async function applyMove() {
    const fd = new FormData();
    if (followUp.trim()) fd.append("follow_up", followUp.trim());
    if (moveTo === "Completed") {
      if (closeReason.trim()) fd.append("reason", closeReason.trim());
      await guarded(setBusyMove, () => completeTask(task.id, fd));
    } else {
      if (/pending/i.test(moveTo) && !moveComment.trim()) {
        setUploadFailed("Pending on Others needs a comment: who you are waiting on, and for what.");
        return;
      }
      fd.append("status", moveTo);
      if (moveComment.trim()) fd.append("comment", moveComment.trim());
      if (pendingOn.trim()) fd.append("pending_on", pendingOn.trim());
      await guarded(setBusyMove, () => setTaskStatus(task.id, fd));
    }
  }

  const canEditAnything =
    perms.title || perms.status || perms.outcome || perms.notes ||
    perms.dependencies || perms.learnings || perms.assign;

  const pendingSelected = task.status.includes("Pending");

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
      <div>
        <h1 style={{ fontSize: 16, margin: "0 0 2px", lineHeight: 1.3 }}>{task.action}</h1>
        {/* Stage and priority as icons (hover for the words); due date; the
            parent / child badge. */}
        <div className="small" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <span title={`Stage: ${task.status}`} aria-label={`Stage: ${task.status}`}
            style={{ fontWeight: 700, color: /pending/i.test(task.status) ? "#a8842c" : task.status === "In Progress" ? "var(--brand)" : task.status === "Parked" ? "#7b857e" : task.status === "Completed" ? "#1f6b45" : "#555" }}>
            {task.status === "In Progress" ? "◐" : /pending/i.test(task.status) ? "⏳" : task.status === "Parked" ? "⏸" : task.status === "Completed" ? "●" : task.status === "Cancelled" ? "⊘" : "○"}
          </span>
          {task.priority && task.priority !== "Missing" && task.priority !== "No Priority" && (
            <span title={`Priority: ${task.priority}`} aria-label={`Priority: ${task.priority}`}
              style={{ fontWeight: 700, color: task.priority === "High" ? "#c0262d" : task.priority === "Medium" ? "#a8842c" : "#7b857e" }}>
              {task.priority === "High" ? "▲" : task.priority === "Medium" ? "▲" : "▽"}
            </span>
          )}
          {task.target_date && <span className="muted">due {task.target_date}</span>}
          {parentName
            ? <span className="extra-chip" title={`Subtask of ${parentName}`}>↳ child</span>
            : childCount > 0 ? <span className="extra-chip" title={`${childCount} open subtasks`}>parent · {childCount}</span> : null}
        </div>
      </div>

      {isOpen && (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          {uploadFailed && <p className="error small" style={{ margin: 0 }}>{uploadFailed}</p>}
          {/* Three small buttons on one line - comment, photo, audio. */}
          <div className="btn-row" style={{ gap: 6, flexWrap: "nowrap", alignItems: "center" }}>
            <button type="button" className={quick === "comment" ? "btn small" : "btn ghost small"} onClick={() => setQuick(quick === "comment" ? "none" : "comment")}>
              💬 Comment
            </button>
            {canAttach && (
              <button type="button" className={quick === "photo" ? "btn small" : "btn ghost small"} onClick={() => setQuick(quick === "photo" ? "none" : "photo")}>
                📷 Photo
              </button>
            )}
            {canAttach && (
              <button type="button" className={quick === "audio" ? "btn small" : "btn ghost small"} onClick={() => setQuick(quick === "audio" ? "none" : "audio")}>
                🎙 Audio
              </button>
            )}
            <span className="muted small" style={{ alignSelf: "center", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {evidenceCount > 0 ? `${evidenceCount} file${evidenceCount > 1 ? "s" : ""} attached` : ""}
            </span>
          </div>

          {quick === "photo" && (
            <form onSubmit={submitPhotos} style={{ display: "grid", gap: 8 }}>
              <FileDrop name="photos" accept="image/*,video/*,application/pdf" label="Add photos / files" />
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

          {perms.complete && (
            <div style={{ display: "grid", gap: 10, borderTop: "1px solid var(--line, #e5e7eb)", paddingTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <label htmlFor="te-move" className="small muted" style={{ whiteSpace: "nowrap", margin: 0 }}>Move to</label>
                <select id="te-move" className="input" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}
                  style={{ flex: 1, minWidth: 0 }}>
                  {statusChoices.map((st) => <option key={st}>{st}</option>)}
                </select>
                <button type="button" className="btn small" disabled={moveTo === task.status || busyMove} onClick={applyMove} style={{ whiteSpace: "nowrap" }}>
                  {busyMove ? "Applying..." : "Apply"}
                </button>
              </div>
              {moveTo !== task.status && moveTo !== "Completed" && moveTo !== "Cancelled" && (
                <div style={{ display: "grid", gap: 6 }}>
                  {/pending/i.test(moveTo) && (
                    <input className="input" value={pendingOn} onChange={(e) => setPendingOn(e.target.value)} placeholder="Waiting on whom? (e.g. PSE&G, the architect)" />
                  )}
                  <textarea className="input" rows={2} value={moveComment} onChange={(e) => setMoveComment(e.target.value)}
                    placeholder={/pending/i.test(moveTo) ? "Comment (required): what are you waiting for?" : "Comment (optional) - saved with the move"} />
                </div>
              )}
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
                        : "No evidence attached: add photos or audio above, or write a short reason for closing without it."}
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
              {(moveTo === "Completed" || moveTo === "Cancelled") && (
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="follow-up">Close and start a follow-up (optional)</label>
                  <input
                    id="follow-up"
                    className="input"
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    placeholder="What comes next? e.g. Second coat once the first has cured"
                  />
                  <p className="muted small" style={{ margin: "4px 0 0" }}>
                    Created as the next link in the chain — same project and assignee — and you land on it.
                    It never blocks closing this one.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {evidenceSlot}

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

        {unlocked && perms.title && (
          <Row label="Title">
            <input name="title" className="input" defaultValue={task.action} required />
          </Row>
        )}

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

        {unlocked && (
        <Row label="Priority">
          {unlocked && perms.status ? (
            <select name="priority" className="input" defaultValue={task.priority ?? "No Priority"} style={{ maxWidth: 220 }}>
              {PRIORITIES.map((s) => <option key={s}>{s}</option>)}
            </select>
          ) : (
            task.priority ?? "—"
          )}
        </Row>
        )}

        {unlocked && (
        <Row label="Target date">
          {unlocked && perms.status ? (
            <input name="target_date" type="date" className="input" defaultValue={task.target_date ?? ""} style={{ maxWidth: 220 }} />
          ) : (
            task.target_date ?? "—"
          )}
        </Row>
        )}

        {(unlocked || task.desired_outcome) && (
        <Row label="Desired outcome">
          {unlocked && perms.outcome ? (
            <textarea name="desired_outcome" className="input" rows={4} defaultValue={task.desired_outcome ?? ""} />
          ) : (
            <LongText value={task.desired_outcome} />
          )}
        </Row>
        )}

        <Row label="Notes">
          {unlocked && perms.notes ? (
            <textarea name="notes" className="input" rows={4} defaultValue={task.notes ?? ""} />
          ) : (
            <LongText value={task.notes} />
          )}
        </Row>

        {perms.dependencies && (unlocked || task.dependencies) && (
          <Row label="Dependencies">
            {unlocked ? (
              <textarea name="dependencies" className="input" rows={4} defaultValue={task.dependencies ?? ""} />
            ) : (
              <LongText value={task.dependencies} />
            )}
          </Row>
        )}

        {perms.learnings && (unlocked || task.learnings) && (
          <Row label="Learnings (admin)">
            {unlocked ? (
              <textarea name="learnings" className="input" rows={4} defaultValue={task.learnings ?? ""} />
            ) : (
              <LongText value={task.learnings} />
            )}
          </Row>
        )}

        <Row label="Assigned to">
          {unlocked && perms.assign ? (
            <span style={{ display: "grid", gap: 8 }}>
              <select name="assigned_to" className="input" defaultValue={task.assignedToContactId ?? ""} style={{ maxWidth: 260 }}>
                <option value="">Unassigned</option>
                {members.map((m) => (
                  <option key={m.contactId} value={m.contactId}>
                    {m.trade ? `${m.trade}: ${m.name}` : m.name}
                  </option>
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
                  <select name="nc_trade" className="input" defaultValue="">
                    <option value="">Trade (optional)</option>
                    {trades.map((t) => <option key={t}>{t}</option>)}
                  </select>
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
        {task.assignedByName && <Row label="Assigned by">{task.assignedByName}</Row>}
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

    </div>
  );
}
