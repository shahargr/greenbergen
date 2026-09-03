"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FileDrop } from "@/components/FileDrop";
import { saveTask, uploadEvidence } from "./task/[id]/actions";

// A task as the homepage week tables carry it. Everything richer is fetched
// ON OPEN (one lookup per opened task) so the page load never pays for it.
export type CardTask = {
  id: string;
  action: string;
  target_date: string | null;
  priority: string | null;
  assignee: string | null;
};

type Detail = {
  status: string;
  priority: string | null;
  target_date: string | null;
  desired_outcome: string | null;
  notes: string | null;
  pending_on: string | null;
  pending_reason: string | null;
  requires_photo_evidence: boolean | null;
  created_at: string | null;
  created_by: string | null;
  last_updated: string | null;
  project: string | null;
  project_id: string;
  assignee: { id: string; name: string } | null;
  evidence: { id: string; file_name: string; kind: string | null; bucket: string; path: string; role: string }[];
  comments: { author: string; body: string; created_at: string }[];
  open_children: number;
};

const OPEN = ["Not Started", "In Progress", "Pending on Others", "Parked"];
const PRIORITIES = ["High", "Medium", "Low", "No Priority"];
const when = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

// Clickable week-table task row (4 columns: Day · What · Who · Amount).
// Click → the task opens beneath it READ-ONLY and fires its one lookup;
// "Edit" switches to a form (Save / Cancel); evidence uploads through the
// same actions the task page uses, returning here (back="/my").
export function CardTaskRow({ task, day }: { task: CardTask; day: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    if (!open || detail || loading) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase.rpc("portal_task_detail", { p_task: task.id });
      if (cancelled) return;
      const d = (data ?? null) as Detail | null;
      setDetail(d);
      setStatus(d?.status ?? "");
      setLoading(false);
      if (d?.evidence?.length) {
        const signed: Record<string, string> = {};
        await Promise.all(d.evidence.map(async (f) => {
          const { data: s } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 3600);
          if (s?.signedUrl) signed[f.id] = s.signedUrl;
        }));
        if (!cancelled) setUrls(signed);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function post(run: () => Promise<void>) {
    setBusy(true);
    setErr("");
    try {
      await run();
    } catch (x) {
      if (x && typeof x === "object" && "digest" in x && String(x.digest).startsWith("NEXT_REDIRECT")) throw x;
      setBusy(false);
      setErr(x instanceof Error ? x.message : "Could not save.");
    }
  }
  async function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    await post(() => saveTask(task.id, fd));
  }
  async function submitEvidence(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    if (!Array.from(fd.getAll("files")).some((f) => f instanceof File && f.size > 0)) {
      setErr("Add a photo or file first.");
      return;
    }
    await post(() => uploadEvidence(task.id, fd));
  }

  const cell = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
  const Field = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ minWidth: 0 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
      <div style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
    </div>
  );
  const isPending = status.includes("Pending");
  const statusChoices = [...new Set([...OPEN, detail?.status ?? "", "Completed", "Cancelled"].filter(Boolean))];

  return (
    <Fragment>
      <tr
        onClick={() => { setOpen(!open); setMode("view"); setErr(""); }}
        aria-expanded={open}
        title={open ? "Close" : "Open this task"}
        style={{ cursor: "pointer" }}
      >
        <td className="muted" style={{ whiteSpace: "nowrap" }}>{day}</td>
        <td style={cell}>
          {task.priority === "High" && <span style={{ color: "#c0262d" }}>● </span>}{task.action}
        </td>
        <td className="muted" style={cell}>{task.assignee ? task.assignee.split(" ")[0] : "—"}</td>
        <td className="muted" style={{ textAlign: "right", fontSize: 11 }}>{open ? "▴" : "▾"}</td>
      </tr>

      {open && mode === "view" && (
        <tr className="tasktable-expand">
          <td colSpan={4}>
            <div style={{ display: "grid", gap: 10, padding: "8px 0 10px", minWidth: 0 }}>
              {loading && <span className="muted small">Loading details…</span>}
              {detail && (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }} className="small">
                    <Field label="Status" value={<strong>{detail.status}</strong>} />
                    <Field label="Priority" value={detail.priority ?? "—"} />
                    <Field label="Due" value={detail.target_date ?? "—"} />
                    <Field label="Assigned to" value={detail.assignee?.name ?? "—"} />
                    <Field label="Project" value={detail.project ?? "—"} />
                    <Field label="Updated" value={<>{when(detail.last_updated)}</>} />
                  </div>
                  {detail.pending_on && (
                    <div className="small"><span className="muted">Waiting on: </span><strong>{detail.pending_on}</strong>
                      {detail.pending_reason && <span className="muted"> — {detail.pending_reason}</span>}</div>
                  )}
                  {detail.desired_outcome && <div className="small"><span className="muted">Outcome: </span>{detail.desired_outcome}</div>}
                  {detail.notes && <div className="small" style={{ whiteSpace: "pre-line" }}><span className="muted">Notes: </span>{detail.notes}</div>}
                  {detail.open_children > 0 && (
                    <div className="small" style={{ color: "#c0262d" }}>
                      <Link href={`/my/project/${detail.project_id}?parent=${task.id}`} style={{ color: "inherit", fontWeight: 600 }}>
                        {detail.open_children} open subtask{detail.open_children > 1 ? "s" : ""} →
                      </Link>{" "}— must close before this can complete.
                    </div>
                  )}
                  <div>
                    <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                      Evidence · {detail.evidence.length}
                    </div>
                    {detail.evidence.length === 0 && <span className="muted small">Nothing attached yet.</span>}
                    {detail.evidence.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                        {detail.evidence.map((f) => {
                          const u = urls[f.id];
                          return u ? (
                            <a key={f.id} href={u} target="_blank" rel="noreferrer" title={f.file_name} style={{ textDecoration: "none" }}>
                              {f.kind === "photo"
                                // eslint-disable-next-line @next/next/no-img-element
                                ? <img src={u} alt={f.file_name} style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid #e7e9e4" }} />
                                : <span className="extra-chip">{f.kind === "audio" ? "🎙" : "📄"} {f.file_name}</span>}
                            </a>
                          ) : <span key={f.id} className="extra-chip">{f.file_name}</span>;
                        })}
                      </div>
                    )}
                  </div>
                  {detail.comments.length > 0 && (
                    <div style={{ display: "grid", gap: 4 }}>
                      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Latest comments</div>
                      {detail.comments.map((c, i) => (
                        <div key={i} className="small" style={{ borderLeft: "3px solid var(--brand, #1f6b45)", paddingLeft: 8 }}>
                          <span className="muted"><strong style={{ color: "inherit" }}>{c.author}</strong> · {when(c.created_at)}</span>
                          <div style={{ whiteSpace: "pre-line" }}>{c.body}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <button type="button" className="btn small" onClick={() => { setMode("edit"); setErr(""); }} disabled={busy || !detail}>✏️ Edit</button>
                <button type="button" className="btn ghost small" onClick={() => setOpen(false)} disabled={busy}>Close</button>
                <Link href={`/my/task/${task.id}`} className="small">Open task page →</Link>
              </div>
              <form onSubmit={submitEvidence} style={{ display: "grid", gap: 6 }}>
                <input type="hidden" name="back" value="/my" />
                <FileDrop name="files" accept="image/*,video/*,application/pdf" label="Add evidence" />
                <div><button className="btn ghost small" disabled={busy}>{busy ? "Uploading…" : "Upload evidence"}</button></div>
              </form>
            </div>
          </td>
        </tr>
      )}

      {open && mode === "edit" && detail && (
        <tr className="tasktable-expand">
          <td colSpan={4}>
            <form onSubmit={submitEdit} style={{ display: "grid", gap: 8, padding: "8px 0 10px", minWidth: 0 }}>
              <input type="hidden" name="back" value="/my" />
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`ct-t-${task.id}`}>Task</label>
                <input id={`ct-t-${task.id}`} name="title" className="input" defaultValue={task.action} required />
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ct-s-${task.id}`}>Status</label>
                  <select id={`ct-s-${task.id}`} name="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                    {statusChoices.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ct-p-${task.id}`}>Priority</label>
                  <select id={`ct-p-${task.id}`} name="priority" className="input" defaultValue={detail.priority ?? "Medium"}>
                    {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ct-d-${task.id}`}>Due</label>
                  <input id={`ct-d-${task.id}`} name="target_date" type="date" className="input" defaultValue={detail.target_date ?? ""} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor={`ct-o-${task.id}`}>Desired outcome</label>
                  <input id={`ct-o-${task.id}`} name="desired_outcome" className="input" defaultValue={detail.desired_outcome ?? ""} />
                </div>
              </div>
              {isPending && (
                <div className="form-2col">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`ct-po-${task.id}`}>Waiting on</label>
                    <input id={`ct-po-${task.id}`} name="pending_on" className="input" defaultValue={detail.pending_on ?? ""} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor={`ct-pr-${task.id}`}>Reason</label>
                    <input id={`ct-pr-${task.id}`} name="pending_reason" className="input" defaultValue={detail.pending_reason ?? ""} />
                  </div>
                </div>
              )}
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor={`ct-n-${task.id}`}>Notes</label>
                <textarea id={`ct-n-${task.id}`} name="notes" className="input" rows={3} defaultValue={detail.notes ?? ""} />
              </div>
              {status === "Completed" && (
                <div style={{ display: "grid", gap: 4 }}>
                  <p className="muted small" style={{ margin: 0 }}>
                    Completing needs evidence attached{detail.evidence.length > 0 ? ` — ${detail.evidence.length} on file ✓` : ""}.
                  </p>
                  {detail.evidence.length === 0 && (
                    <label className="small" style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                      <input type="checkbox" name="force_close" />
                      <span>No evidence to attach — close anyway (recorded in the notes)</span>
                    </label>
                  )}
                  {detail.requires_photo_evidence && (
                    <p className="small" style={{ margin: 0, color: "#c0262d" }}>This task requires BEFORE and AFTER photos — it cannot be force-closed.</p>
                  )}
                </div>
              )}
              {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
              <div className="btn-row">
                <button className="btn small" disabled={busy}>{busy ? "Saving..." : "Save"}</button>
                <button type="button" className="btn ghost small" onClick={() => { setMode("view"); setErr(""); setStatus(detail.status); }} disabled={busy}>Cancel</button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </Fragment>
  );
}
