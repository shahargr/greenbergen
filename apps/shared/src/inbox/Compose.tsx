"use client";

import { useMemo, useRef, useState } from "react";
import { createClient } from "../supabase/client";
import { friendly } from "../rpc";
import { messageSend } from "./actions";
import type { Target } from "./data";

// Write to someone you work with.
//
// IT USED TO ASK FOR THE PROJECT FIRST, and that was backwards twice over.
// A person thinks of the PERSON, not the filing cabinet; and when the picked
// project had nobody else on it - a home with no contractor yet - the "To"
// select rendered with no options at all, so the form looked ready and Send
// failed. Now you type a name, the list is everyone you can reach across
// every project you are on, and picking one fills in the project too.
//
// AND IT USED TO SIT OPEN AT THE BOTTOM OF THE INBOX, which put a blank
// form - three fields and a dead Send button - under a list of one message.
// An inbox is for reading. Writing is a thing you decide to do, so it is a
// button, and the form arrives when you mean it.
//
// WHY IT IS ONLY PEOPLE ON YOUR PROJECTS. send_portal_message checks that
// both of you are on the project it is filed against, and that check is
// right: a message is about a job. Offering the whole contractor roster here
// would build a picker that mostly fails - and a back channel around the
// community price, which is the one thing the model does not want.
type Entry = { key: string; contact_id: string; project_id: string; name: string; seat: string | null; project_name: string; me: boolean };
type Task = { id: string; action: string; status: string };

export function Compose({ targets, base }: { targets: Target[]; base: string }) {
  const entries = useMemo<Entry[]>(
    () => targets.flatMap((t) => (t.people ?? []).map((p) => ({
      key: `${p.contact_id}|${t.project_id}`,
      contact_id: p.contact_id, project_id: t.project_id,
      name: p.name, seat: p.seat, project_name: t.project_name, me: !!p.me,
    }))),
    [targets],
  );
  // One person on two of your projects is two entries, so the label carries
  // the project - it is what makes them distinguishable, and it is what the
  // message will be filed against.
  // Yourself reads as what it is - a note to self on that project - not as
  // your own name listed beside the others as though you were someone else.
  const label = (e: Entry) => e.me
    ? `Me — a note to myself — ${e.project_name}`
    : `${e.name}${e.seat ? ` · ${e.seat}` : ""} — ${e.project_name}`;
  const byLabel = useMemo(() => new Map(entries.map((e) => [label(e), e])), [entries]);

  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const picked = byLabel.get(typed.trim()) ?? null;

  // What rides along. Both are resolved from the picked project, and the
  // database checks that again - it drops a reference that does not belong
  // to the project rather than sending it on.
  const [tasks, setTasks] = useState<Task[]>([]);
  const [task, setTask] = useState("");
  const [fileId, setFileId] = useState("");
  const [shot, setShot] = useState<{ name: string; preview: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const pick = useRef<HTMLInputElement>(null);
  const loadedFor = useRef<string | null>(null);

  // The tasks of whichever project the chosen person is on. Fetched when the
  // person is chosen, not on every keystroke, and only once per project.
  async function loadTasks(projectId: string) {
    if (loadedFor.current === projectId) return;
    loadedFor.current = projectId;
    setTask("");
    const supabase = createClient();
    const { data } = await supabase.rpc("project_open_tasks", { p_project: projectId });
    setTasks(Array.isArray(data) ? data : []);
  }

  // A photo is uploaded the moment it is picked, exactly like the job photo
  // slots: nothing to forget, and the id is ready before Send is pressed.
  async function attach(file: File | null | undefined) {
    if (!file || !picked) return;
    setErr(""); setBusy(true);
    const preview = URL.createObjectURL(file);
    const supabase = createClient();
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    const path = `${picked.project_id}/messages/${Date.now()}${ext}`;
    const { error: upErr } = await supabase.storage.from("project-media").upload(path, file, { contentType: file.type || undefined });
    if (upErr) { setBusy(false); setErr(upErr.message); return; }
    const { data, error } = await supabase.rpc("record_project_file", {
      p_project_id: picked.project_id, p_path: path, p_file_name: file.name,
      p_mime: file.type || "image/jpeg", p_size: file.size, p_caption: null, p_kind: "photo",
    });
    setBusy(false);
    if (error || !data) { setErr(friendly(error?.message ?? "That photo didn't attach.")); return; }
    setFileId(String(data));
    setShot({ name: file.name, preview });
  }

  if (entries.length === 0) {
    return (
      <p className="small text-muted" style={{ margin: 0 }}>
        Nobody to write to yet. A conversation starts when someone else is on one of your
        jobs — a contractor who accepted, or a person you invited.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary btn-block" onClick={() => setOpen(true)}>
        Write to someone
      </button>
    );
  }

  return (
    <form action={messageSend} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="base" value={base} />
      {/* Both resolved from the one thing that was typed, so they can never
          disagree with each other or with what is on screen. */}
      <input type="hidden" name="to" value={picked?.contact_id ?? ""} />
      <input type="hidden" name="project" value={picked?.project_id ?? ""} />
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="action_id" value={task} />

      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">To</span>
        <input
          className="input" list="compose-people" autoComplete="off" placeholder="Start typing a name…"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            const hit = byLabel.get(e.target.value.trim());
            if (hit) void loadTasks(hit.project_id);
          }}
        />
        <datalist id="compose-people">
          {entries.map((e) => <option key={e.key} value={label(e)} />)}
        </datalist>
        <p className="hint">
          {picked
            ? picked.me ? `A note to yourself, filed against ${picked.project_name}.` : `Filed against ${picked.project_name}.`
            : typed.trim()
              ? "Pick one from the list — that is how we know which job it is about."
              : `${entries.length} ${entries.length === 1 ? "person" : "people"} across your projects.`}
        </p>
      </label>

      <textarea name="body" className="input" rows={3} placeholder="What do you need to say?" required />

      {/* WHAT IT IS ABOUT. A message with the photo of the panel in it is
          worth more than the same sentence on its own, and a message tied to
          a task is a message somebody can act on. Both only make sense once
          a person - and so a project - is chosen. */}
      {picked && (
        <div className="stack" style={{ gap: 8 }}>
          {shot ? (
            <div className="row" style={{ gap: 10, alignItems: "center" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.preview} alt="" style={{ width: 46, height: 46, borderRadius: 10, objectFit: "cover" }} />
              <span className="grow small" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{shot.name}</span>
              <button type="button" className="btn btn-ghost small"
                      onClick={() => { setShot(null); setFileId(""); }}>Remove</button>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost small" style={{ alignSelf: "flex-start" }}
                    disabled={busy} onClick={() => pick.current?.click()}>
              {busy ? "Attaching…" : "Attach a photo"}
            </button>
          )}
          <input ref={pick} type="file" accept="image/*" hidden
                 onChange={(e) => { void attach(e.target.files?.[0]); e.target.value = ""; }} />

          {tasks.length > 0 && (
            <label className="field" style={{ marginBottom: 0 }}>
              <span className="field-label">About a task <span className="text-muted">(optional)</span></span>
              <select className="input" value={task} onChange={(e) => setTask(e.target.value)}>
                <option value="">Not about a particular task</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.action}</option>)}
              </select>
            </label>
          )}
        </div>
      )}

      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary grow" disabled={!picked || busy}>Send</button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
