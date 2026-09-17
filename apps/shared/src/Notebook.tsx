"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";
import { Evidence, type Attached } from "./Evidence";

// ONE BUTTON, THREE THINGS TO WRITE DOWN, AND SOMETHING THAT GOES THROUGH
// THEM LATER.
//
// Shahar (2026-09-15): "that floaty thing for the notes is fantastic. I think
// we need the floaty thing for easy tasks as well... we can have a process
// that goes after them one by one at the end of the day."
//
// And (2026-09-16): "The floating icons (todo / note / order) to all, have the
// same size of screen opens with text box, take photo, attach image/file, and
// record voice. Working on computer, great to allow drop on files. Saving time
// is priority. If user clicks on it from inside a project, and trade, auto
// populate these into the job selection box. Job selection can be as granular
// as Job / Project / Task / etc ... and limit to what I can actually see from
// permission stand point."
//
// THREE KINDS, ONE SHEET. A to-do is work, an order is a thing arriving, a
// note is neither - and the only difference between the first two in the
// database is actions.delivers, which has said 'work' or 'product' since long
// before anything wrote 'product'. So they wear the same sheet, the same
// size, with the same four ways to say something: type it, photograph it,
// attach it, speak it.
//
// SAVING TIME IS THE POINT. Everything the sheet can work out for itself, it
// does: the job and the trade come from the screen you were standing on, and
// the picker opens already on the right one. What it cannot work out - which
// job, when you are nowhere near one - it asks once and then remembers for the
// rest of the session.
//
// WHAT IS PRIVATE AND WHAT IS NOT, said rather than implied. A note's WORDS
// are yours alone, by a row policy (migration 141). A note's FILES are the
// job's: record_project_file requires can_edit_project and stores under
// project-media/<job>/, so a photograph necessarily belongs to a job. Both
// halves are true and the sheet says so, because the alternative is a promise
// that gets found out.

type NoteFile = { id: string; name: string | null; kind: string | null; bucket: string; path: string };

type Note = {
  id: string;
  body: string;
  intent: "note" | "task";
  project_id: string | null;
  project: string | null;
  trade: string | null;
  action_id: string | null;
  task: string | null;
  screen: string | null;
  pinned: boolean;
  created_at: string;
  reviewed_at: string | null;
  archived: boolean;
  became_action_id: string | null;
  became: string | null;
  files: NoteFile[];
};

type Book = { notes: Note[]; open: number; here: number; to_sweep: number };
type Job = { id: string; name: string; parent_id: string | null; address: string | null; is_property: boolean; depth: number };
type Step = { id: string; action: string; trade: string | null; accepts_steps: boolean };
type Targets = { projects: Job[]; tasks: Step[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Where you are standing, read off the path. The database checks all of it
 *  and drops whatever you may not see, so a wrong guess here is harmless. */
export function whereFrom(path: string): { project?: string; trade?: string; action?: string } {
  const bits = path.split("/").filter(Boolean).map((b) => decodeURIComponent(b));
  const out: { project?: string; trade?: string; action?: string } = {};
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === "project" && UUID.test(bits[i + 1] ?? "")) out.project = bits[i + 1];
    if (bits[i] === "task" && UUID.test(bits[i + 1] ?? "")) out.action = bits[i + 1];
    if (bits[i] === "trade" && bits[i + 1]) out.trade = bits[i + 1];
  }
  return out;
}

const when = (iso: string) => {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

type Tab = "todo" | "note" | "order" | "book";

const KIND: Record<"todo" | "note" | "order", { tab: string; verb: string; hint: string }> = {
  todo:  { tab: "To do",  verb: "Add it",   hint: "Order the stair treads before Friday" },
  note:  { tab: "Note",   verb: "Keep it",  hint: "Ask Javier whether the LVL at the landing needs a third jack stud — he said two on site, the plan shows three." },
  order: { tab: "Order",  verb: "Order it", hint: "40 oak stair treads, 11in × 42in, from Kuiken Brothers" },
};

export function Notebook() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("todo");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [job, setJob] = useState("");
  const [step, setStep] = useState("");
  const [jobTouched, setJobTouched] = useState(false);
  const [files, setFiles] = useState<Attached[]>([]);
  // Files taken before a job was picked, still in the browser (Evidence
  // holds them and sends them up when the job arrives).
  const [heldN, setHeldN] = useState(0);
  const [book, setBook] = useState<Book | null>(null);
  const [targets, setTargets] = useState<Targets>({ projects: [], tasks: [] });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const [scope, setScope] = useState<"here" | "all">("here");
  const [sweep, setSweep] = useState<Note[] | null>(null);
  const [at, setAt] = useState(0);
  const [sweepJob, setSweepJob] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const here = whereFrom(path);
  const hidden = /^\/(login|join|welcome|s)\b/.test(path);

  // Where you are standing wins until you say otherwise - and saying
  // otherwise sticks, because filing three things for one job should not mean
  // picking it three times.
  useEffect(() => {
    if (!jobTouched) setJob(here.project ?? "");
  }, [here.project, jobTouched]);

  // One read on arrival: the count the button wears, and the jobs the pickers
  // need before they can ask anything.
  useEffect(() => {
    let live = true;
    void (async () => {
      const c = createClient();
      const [b, t] = await Promise.all([
        c.rpc("portal_notes", { p_project: null, p_trade: null, p_show: "open", p_limit: 0 }),
        c.rpc("portal_capture_targets", { p_project: null }),
      ]);
      if (!live) return;
      if (b.data) setBook((x) => x ?? (b.data as Book));
      if (t.data) setTargets(t.data as Targets);
    })();
    return () => { live = false; };
  }, []);

  // The tasks belong to whichever job is selected, so they follow it rather
  // than being fetched for a board nobody is looking at.
  useEffect(() => {
    if (!job) { setTargets((t) => ({ ...t, tasks: [] })); setStep(""); return; }
    let live = true;
    void (async () => {
      const { data } = await createClient().rpc("portal_capture_targets", { p_project: job });
      if (live && data) setTargets(data as Targets);
    })();
    return () => { live = false; };
  }, [job]);

  const read = useCallback(async (show: string) => {
    const { data, error } = await createClient().rpc("portal_notes", {
      p_project: show === "open" && scope === "here" ? here.project ?? null : null,
      p_trade: show === "open" && scope === "here" ? here.trade ?? null : null,
      p_show: show,
    });
    if (error) { setErr(friendly(error.message)); return null; }
    return data as Book;
  }, [scope, here.project, here.trade]);

  useEffect(() => {
    if (open && tab === "book" && !sweep) void read("open").then((b) => { if (b) setBook(b); });
  }, [open, tab, sweep, read]);
  useEffect(() => { if (open && tab !== "book") box.current?.focus(); }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { if (sweep) setSweep(null); else setOpen(false); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, sweep]);

  if (hidden) return null;

  const jobs = targets.projects;
  const steps = targets.tasks;
  const jobName = jobs.find((j) => j.id === job)?.name ?? null;
  const kind = tab === "book" ? null : KIND[tab];
  const ids = files.map((f) => f.id);

  function clear(msg: string) {
    setBody(""); setDue(""); setStep(""); setFiles([]); setSaid(msg); box.current?.focus();
  }

  // A THING TO DO, or A THING TO ORDER. With a job it is a task, now, on the
  // job. Without one it is held as a capture and comes back tonight, which
  // beats refusing to write it down and beats guessing a job.
  async function keep() {
    const text = body.trim();
    if (!text && ids.length === 0) return;
    setBusy(true); setErr("");
    const c = createClient();

    if (tab !== "note" && job) {
      const { data, error } = await c.rpc("portal_task_quick", {
        p_project: job,
        p_action: (text.split("\n")[0] || "Something to do").slice(0, 300),
        p_trade: here.trade ?? null,
        p_target_date: due || null,
        p_parent: step || null,
        p_delivers: tab === "order" ? "product" : "work",
        p_file_ids: ids.length ? ids : null,
      });
      setBusy(false);
      if (error) { setErr(friendly(error.message)); return; }
      if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
      clear(`${tab === "order" ? "Ordered" : "On the board"}${jobName ? ` — ${jobName}` : ""}.`);
      return;
    }

    const { data, error } = await c.rpc("portal_note_add", {
      p_body: text,
      p_project: tab === "note" ? job || here.project || null : null,
      p_trade: here.trade ?? null,
      p_action: tab === "note" ? step || here.action || null : null,
      p_screen: path,
      p_intent: tab === "note" ? "note" : "task",
      p_file_ids: ids.length ? ids : null,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not written down."); return; }
    setBook((b) => (b ? { ...b, open: b.open + 1, to_sweep: b.to_sweep + 1 } : b));
    clear(tab === "note"
      ? (data.trade ? `Kept under ${data.trade}.` : data.project_id ? "Kept on this job." : "Kept.")
      : "Held — you'll be asked which job tonight.");
  }

  async function act(fn: string, args: Record<string, unknown>) {
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return false; }
    if (!data?.ok) { setErr(data?.reason ?? "That did not work."); return false; }
    return true;
  }

  async function startSweep() {
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_notes", {
      p_project: null, p_trade: null, p_show: "sweep",
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    const b = data as Book;
    setBook(b); setSweep(b.notes); setAt(0); setSweepJob(""); setSaid("");
  }

  function next(msg: string) {
    setSaid(msg); setSweepJob("");
    setBook((b) => (b ? { ...b, to_sweep: Math.max(0, b.to_sweep - 1) } : b));
    setAt((i) => i + 1);
  }

  const card = sweep?.[at] ?? null;
  const count = book?.open ?? 0;
  const waiting = book?.to_sweep ?? 0;
  const notes = book?.notes ?? [];

  // ONE PICKER, WRITTEN ONCE, so the capture tabs and the sweep cannot drift
  // into disagreeing about which jobs exist. Indented by depth: a property and
  // the jobs under it stay together and read as a tree in a plain select.
  const jobOptions = (withDecide: boolean) => (
    <>
      {withDecide && <option value="">Decide tonight</option>}
      {!withDecide && <option value="">Choose a job…</option>}
      {jobs.map((j) => (
        <option key={j.id} value={j.id}>
          {"  ".repeat(j.depth)}{j.depth > 0 ? "└ " : ""}{j.name}
        </option>
      ))}
    </>
  );

  return (
    <>
      <button type="button" className={`nb-fab${open ? " on" : ""}`}
        aria-label={count > 0 ? `Notebook — ${count} kept` : "Write something down"}
        onClick={() => { setOpen((o) => !o); setSaid(""); setErr(""); setSweep(null); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M9 3v18M12 8h4M12 12h4" />
        </svg>
        {count > 0 && <span className="n">{count > 99 ? "99+" : count}</span>}
      </button>

      {open && (
        <>
          <button type="button" className="nb-scrim" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="nb-sheet" role="dialog" aria-label="Write something down">
            <div className="nb-head">
              {sweep ? (
                <>
                  <button type="button" className="nb-back" onClick={() => setSweep(null)}>‹ Back</button>
                  <span className="nb-title">
                    End of day{sweep.length > 0 ? ` · ${Math.min(at + 1, sweep.length)} of ${sweep.length}` : ""}
                  </span>
                </>
              ) : (
                <div className="nb-tabs">
                  {(["todo", "note", "order"] as const).map((k) => (
                    <button key={k} type="button" className={tab === k ? "on" : ""}
                      onClick={() => { setTab(k); setSaid(""); setErr(""); }}>{KIND[k].tab}</button>
                  ))}
                  <button type="button" className={tab === "book" ? "on" : ""}
                    onClick={() => { setTab("book"); setSaid(""); setErr(""); }}>
                    Book{count > 0 ? ` · ${count}` : ""}
                  </button>
                </div>
              )}
              <button type="button" className="nb-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            {/* ── THE CAPTURE SHEET. One shape for all three kinds, which is
                what "have the same size of screen" asks for: the body keeps a
                floor so the sheet does not jump as you move between tabs. ── */}
            {!sweep && kind && (
              <div className="nb-body nb-capture">
                <textarea ref={box} className="input nb-text" value={body}
                  rows={tab === "note" ? 4 : 3} maxLength={4000}
                  onChange={(e) => { setBody(e.target.value); setSaid(""); }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) { e.preventDefault(); void keep(); }
                  }}
                  placeholder={kind.hint} />

                <div className="nb-two">
                  <label className="nb-fld">
                    <span>Which job</span>
                    <select className="input" value={job}
                      onChange={(e) => { setJob(e.target.value); setJobTouched(true); setSaid(""); }}>
                      {jobOptions(tab !== "note")}
                    </select>
                  </label>
                  {tab !== "note" && (
                    <label className="nb-fld">
                      <span>When</span>
                      <input className="input" type="date" value={due}
                        onChange={(e) => setDue(e.target.value)} disabled={!job} />
                    </label>
                  )}
                </div>

                {/* GRANULARITY: "Job / Project / Task / etc". A job narrows to
                    one of its tasks, and only the tasks the ladder lets you
                    see are offered - a contract-bounded trade gets their own
                    work and not the bidding. A simple task takes no steps, so
                    it is offered to a note and refused to a to-do. */}
                {job && steps.length > 0 && (
                  <label className="nb-fld">
                    <span>{tab === "note" ? "About which task" : "Under which task"} <span className="text-muted">(optional)</span></span>
                    <select className="input" value={step} onChange={(e) => setStep(e.target.value)}>
                      <option value="">Just the job</option>
                      {steps
                        .filter((s) => tab === "note" || s.accepts_steps)
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.trade ? `${s.trade} · ` : ""}{s.action.slice(0, 80)}
                          </option>
                        ))}
                    </select>
                  </label>
                )}

                {/* CAMERA, FILE OR IMAGE, VOICE - the same three as on a
                    task (Shahar, 2026-09-17: "On the todo we are missing the
                    same evidence logic as we have here"). They used to appear
                    only once a job was picked, because record_project_file
                    requires can_edit_project and stores under that job's
                    media. Now Evidence takes the file first and holds it in
                    the browser; the moment a job is chosen it goes up under
                    that job. What it cannot do is keep a file with NO job -
                    there is nowhere in the store for it - so a held file
                    turns "Hold it for tonight" into a request for the job. */}
                <Evidence projectId={job || null} caption="Capture" folder="notes"
                  accept="image/*,video/*,audio/*,application/pdf"
                  onChange={setFiles} onHeld={setHeldN} />

                <p className="nb-at">
                  {tab === "note"
                    ? <>Only you can read what you write here. Anything you <strong>attach</strong> lives on the
                      job, the same as any site photo.</>
                    : job
                      ? <>Goes straight on the board{here.trade ? <> under <strong>{here.trade}</strong></> : null}
                        {tab === "order" ? " as something to arrive" : ""}. The people on the job can see it.</>
                      : heldN > 0
                        ? <>Pick a job above and {heldN === 1 ? "the file goes" : "the files go"} on it with this. Without a job there is nowhere to keep {heldN === 1 ? "it" : "them"}.</>
                        : <>No job yet, so it is held in your notebook and the end-of-day sweep asks which one.</>}
                </p>

                <button type="button" className="btn btn-primary"
                  disabled={(!body.trim() && ids.length === 0) || busy || (!job && heldN > 0)}
                  onClick={() => { void keep(); }}>
                  {busy ? "…" : !job && heldN > 0 ? "Pick a job first" : tab !== "note" && !job ? "Hold it for tonight" : kind.verb}
                </button>
                {said && <p className="nb-ok">{said} Still open — keep going.</p>}
                {err && <p className="nb-err">{err}</p>}
              </div>
            )}

            {/* ── THE BOOK ──────────────────────────────────────────────── */}
            {!sweep && tab === "book" && (
              <div className="nb-body">
                {waiting > 0 && (
                  <button type="button" className="nb-sweep" disabled={busy}
                    onClick={() => { void startSweep(); }}>
                    <span className="grow">
                      <span className="t">Go through them</span>
                      <span className="m">One at a time — make it a task, keep it, or be done with it</span>
                    </span>
                    <span className="n">{waiting}</span>
                  </button>
                )}

                {here.project && (
                  <div className="nb-scope">
                    <button type="button" className={scope === "here" ? "on" : ""}
                      onClick={() => setScope("here")}>{here.trade ?? "This job"}</button>
                    <button type="button" className={scope === "all" ? "on" : ""}
                      onClick={() => setScope("all")}>Everything</button>
                  </div>
                )}

                {notes.length === 0 && (
                  <p className="nb-none">
                    Nothing here yet. Whatever you want to come back to — write it on one of the other tabs.
                  </p>
                )}

                <ul className="nb-list">
                  {notes.map((n) => (
                    <li key={n.id} className={`nb-note${n.pinned ? " pin" : ""}`}>
                      {n.intent === "task" && <span className="tagline">meant to be a task</span>}
                      {n.body && <p className="b">{n.body}</p>}
                      <p className="w">
                        {[n.trade, n.project, n.task,
                          n.files.length ? `${n.files.length} attached` : null,
                          when(n.created_at)].filter(Boolean).join(" · ")}
                      </p>
                      <div className="acts">
                        <button type="button" disabled={busy || !n.project_id}
                          title={n.project_id ? undefined : "No job on this one — go through them to place it"}
                          onClick={async () => {
                            if (await act("portal_note_to_task", { p_note: n.id })) {
                              setSaid("It is a task now.");
                              const b = await read("open"); if (b) setBook(b);
                            }
                          }}>Make it a task</button>
                        <button type="button" disabled={busy}
                          onClick={async () => {
                            if (await act("portal_note_edit", { p_note: n.id, p_pinned: !n.pinned })) {
                              const b = await read("open"); if (b) setBook(b);
                            }
                          }}>{n.pinned ? "Unpin" : "Pin"}</button>
                        <button type="button" disabled={busy}
                          onClick={async () => {
                            if (await act("portal_note_archive", { p_note: n.id })) {
                              setSaid("Put away — not deleted.");
                              const b = await read("open"); if (b) setBook(b);
                            }
                          }}>Done with it</button>
                      </div>
                    </li>
                  ))}
                </ul>
                {said && <p className="nb-ok">{said}</p>}
                {err && <p className="nb-err">{err}</p>}
              </div>
            )}

            {/* ── THE SWEEP ─────────────────────────────────────────────── */}
            {sweep && (
              <div className="nb-body">
                {!card ? (
                  <div className="nb-done">
                    <p className="t">That&apos;s the lot.</p>
                    <p className="m">
                      {sweep.length === 0
                        ? "Nothing was waiting — you are already through today."
                        : `${sweep.length} gone through. Anything you kept comes back tomorrow.`}
                    </p>
                    <button type="button" className="btn btn-secondary"
                      onClick={() => { setSweep(null); setTab("book"); }}>Back to the book</button>
                  </div>
                ) : (
                  <>
                    {card.intent === "task" && <span className="tagline">you meant this to be a task</span>}
                    <p className="nb-card">{card.body || "(nothing written — see what is attached)"}</p>
                    <p className="w">
                      {[card.trade, card.project, card.task,
                        card.files.length ? `${card.files.length} attached` : null,
                        when(card.created_at)].filter(Boolean).join(" · ")}
                    </p>

                    {!card.project_id && (
                      <label className="nb-fld">
                        <span>Which job</span>
                        <select className="input" value={sweepJob} onChange={(e) => setSweepJob(e.target.value)}>
                          {jobOptions(false)}
                        </select>
                      </label>
                    )}

                    <div className="nb-choose">
                      <button type="button" className="btn btn-primary"
                        disabled={busy || (!card.project_id && !sweepJob)}
                        onClick={async () => {
                          if (await act("portal_note_to_task", {
                            p_note: card.id, p_project: card.project_id ? null : sweepJob,
                          })) next("Made it a task.");
                        }}>Make it a task</button>
                      <button type="button" className="btn btn-secondary" disabled={busy}
                        onClick={async () => {
                          if (await act("portal_note_reviewed", { p_note: card.id })) next("Kept.");
                        }}>Keep it</button>
                      <button type="button" className="btn btn-ghost" disabled={busy}
                        onClick={async () => {
                          if (await act("portal_note_archive", { p_note: card.id })) next("Put away.");
                        }}>Done with it</button>
                    </div>
                    {said && <p className="nb-ok">{said}</p>}
                    {err && <p className="nb-err">{err}</p>}
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
