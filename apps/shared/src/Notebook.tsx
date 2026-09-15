"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";

// ONE BUTTON, TWO KINDS OF THING, AND SOMETHING THAT GOES THROUGH THEM LATER.
//
// Shahar (2026-09-15): "that floaty thing for the notes is fantastic. I think
// we need the floaty thing for easy tasks as well. Like, things to do versus
// notes... maybe you can do two tabs when you click on that. So it's one
// click, but you get to do, is this a task or this is a log action? In any
// event, we can have a process that goes after them one by one at the end of
// the day and turn them into a task or into an action. So that becomes kind
// of the back office."
//
// The third sentence is the one that makes the first two work. A capture box
// earns its keep by never asking a question while you are trying to write
// something down - and it turns into a landfill unless something goes through
// it afterwards. So: two tabs to write on, and a sweep that walks what you
// wrote, one card at a time, at the end of the day.
//
// The one question a task cannot avoid is which job it goes on. On a project
// screen that is free - the sheet knows where you are standing. Off one, the
// answer is a picker with "Decide tonight" in it, and the sweep is where
// tonight happens.
//
// Notes are PRIVATE - a row policy, not a screen (migration 141). A task is
// not: it lands on the job, where the people doing the work can see it. That
// difference is the whole reason the two tabs are separate.

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
};

type Job = { id: string; name: string };
type Book = { notes: Note[]; open: number; here: number; to_sweep: number; projects: Job[] };

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

type Tab = "todo" | "note" | "book";

export function Notebook() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("todo");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [job, setJob] = useState<string>("");
  const [jobTouched, setJobTouched] = useState(false);
  const [book, setBook] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const [scope, setScope] = useState<"here" | "all">("here");
  // THE BACK OFFICE. A queue of what you wrote down and a finger on one card.
  const [sweep, setSweep] = useState<Note[] | null>(null);
  const [at, setAt] = useState(0);
  const [sweepJob, setSweepJob] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const here = whereFrom(path);
  const hidden = /^\/(login|join|welcome|s)\b/.test(path);

  // Where you are standing wins until you say otherwise - and saying otherwise
  // sticks, because somebody filing three things for another job should not
  // have to pick it three times.
  useEffect(() => {
    if (!jobTouched) setJob(here.project ?? "");
  }, [here.project, jobTouched]);

  const read = useCallback(async (show: string) => {
    const { data, error } = await createClient().rpc("portal_notes", {
      p_project: show === "open" && scope === "here" ? here.project ?? null : null,
      p_trade: show === "open" && scope === "here" ? here.trade ?? null : null,
      p_show: show,
    });
    if (error) { setErr(friendly(error.message)); return null; }
    return data as Book;
  }, [scope, here.project, here.trade]);

  // One small read on arrival: the count the button wears, and the jobs the
  // To do tab needs before it can ask anything. A notebook you have to open
  // to discover is empty is one you stop opening.
  useEffect(() => {
    let live = true;
    void (async () => {
      const { data } = await createClient().rpc("portal_notes", {
        p_project: null, p_trade: null, p_show: "open", p_limit: 0,
      });
      if (live && data) setBook((b) => b ?? (data as Book));
    })();
    return () => { live = false; };
  }, []);

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

  const jobs = book?.projects ?? [];
  const jobName = jobs.find((j) => j.id === job)?.name ?? null;

  function clear(msg: string) {
    setBody(""); setDue(""); setSaid(msg); box.current?.focus();
  }

  // A THING TO DO. With a job it is a task, now, on the job, where the people
  // doing the work can see it. Without one it is held as a capture and comes
  // back tonight - which is better than refusing to write it down, and better
  // than guessing a job.
  async function addTodo() {
    const text = body.trim();
    if (!text) return;
    setBusy(true); setErr("");
    const c = createClient();
    if (job) {
      const { data, error } = await c.rpc("portal_task_quick", {
        p_project: job, p_action: text.split("\n")[0].slice(0, 300),
        p_trade: here.trade ?? null, p_target_date: due || null,
      });
      setBusy(false);
      if (error) { setErr(friendly(error.message)); return; }
      if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
      clear(`On the board${jobName ? ` — ${jobName}` : ""}.`);
      return;
    }
    const { data, error } = await c.rpc("portal_note_add", {
      p_body: text, p_project: null, p_trade: here.trade ?? null,
      p_action: here.action ?? null, p_screen: path, p_intent: "task",
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not written down."); return; }
    setBook((b) => (b ? { ...b, open: b.open + 1, to_sweep: b.to_sweep + 1 } : b));
    clear("Held — you'll be asked which job tonight.");
  }

  async function addNote() {
    const text = body.trim();
    if (!text) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_note_add", {
      p_body: text, p_project: here.project ?? null, p_trade: here.trade ?? null,
      p_action: here.action ?? null, p_screen: path, p_intent: "note",
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not written down."); return; }
    setBook((b) => (b ? { ...b, open: b.open + 1, here: b.here + 1, to_sweep: b.to_sweep + 1 } : b));
    clear(data.trade ? `Kept under ${data.trade}.` : data.project_id ? "Kept on this job." : "Kept.");
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

  // One decision, then the next card. Nothing is re-read between cards - the
  // queue was settled when the sweep started, so the list cannot shuffle under
  // your finger while you are working down it.
  function next(msg: string) {
    setSaid(msg); setSweepJob("");
    setBook((b) => (b ? { ...b, to_sweep: Math.max(0, b.to_sweep - 1) } : b));
    setAt((i) => i + 1);
  }

  const card = sweep?.[at] ?? null;
  const count = book?.open ?? 0;
  const waiting = book?.to_sweep ?? 0;
  const notes = book?.notes ?? [];

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
                  <button type="button" className={tab === "todo" ? "on" : ""}
                    onClick={() => { setTab("todo"); setSaid(""); }}>To do</button>
                  <button type="button" className={tab === "note" ? "on" : ""}
                    onClick={() => { setTab("note"); setSaid(""); }}>Note</button>
                  <button type="button" className={tab === "book" ? "on" : ""}
                    onClick={() => { setTab("book"); setSaid(""); }}>
                    Book{count > 0 ? ` · ${count}` : ""}
                  </button>
                </div>
              )}
              <button type="button" className="nb-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            {/* ── A THING TO DO ─────────────────────────────────────────── */}
            {!sweep && tab === "todo" && (
              <div className="nb-body">
                <textarea ref={box} className="input nb-text" value={body} rows={3} maxLength={1000}
                  onChange={(e) => { setBody(e.target.value); setSaid(""); }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) { e.preventDefault(); void addTodo(); }
                  }}
                  placeholder="Order the stair treads before Friday" />
                <div className="nb-two">
                  <label className="nb-fld">
                    <span>Which job</span>
                    <select className="input" value={job}
                      onChange={(e) => { setJob(e.target.value); setJobTouched(true); setSaid(""); }}>
                      <option value="">Decide tonight</option>
                      {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                    </select>
                  </label>
                  <label className="nb-fld">
                    <span>When</span>
                    <input className="input" type="date" value={due}
                      onChange={(e) => setDue(e.target.value)} disabled={!job} />
                  </label>
                </div>
                <p className="nb-at">
                  {job
                    ? <>Goes straight on the board{here.trade ? <> under <strong>{here.trade}</strong></> : null}. The
                      people on the job can see it.</>
                    : <>No job yet, so it is held in your notebook and the end-of-day sweep asks which one.</>}
                </p>
                <button type="button" className="btn btn-primary" disabled={!body.trim() || busy}
                  onClick={() => { void addTodo(); }}>
                  {busy ? "…" : job ? "Add it to the job" : "Hold it for tonight"}
                </button>
                {said && <p className="nb-ok">{said} Still open — keep going.</p>}
                {err && <p className="nb-err">{err}</p>}
              </div>
            )}

            {/* ── SOMETHING TO REMEMBER ─────────────────────────────────── */}
            {!sweep && tab === "note" && (
              <div className="nb-body">
                <textarea ref={box} className="input nb-text" value={body} rows={5} maxLength={4000}
                  onChange={(e) => { setBody(e.target.value); setSaid(""); }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) { e.preventDefault(); void addNote(); }
                  }}
                  placeholder="Ask Javier whether the LVL at the landing needs a third jack stud — he said two on site, the plan shows three." />
                <p className="nb-at">
                  {here.trade ? <>Filed under <strong>{here.trade}</strong></>
                    : here.action ? <>Kept against the task you&apos;re on</>
                    : here.project ? <>Kept on this job</>
                    : <>Kept in your notebook — no job attached</>}
                  {" · "}Only you can read it.
                </p>
                <button type="button" className="btn btn-primary" disabled={!body.trim() || busy}
                  onClick={() => { void addNote(); }}>
                  {busy ? "…" : "Keep this"}
                </button>
                {said && <p className="nb-ok">{said} It stays open — keep going.</p>}
                {err && <p className="nb-err">{err}</p>}
              </div>
            )}

            {/* ── THE BOOK ──────────────────────────────────────────────── */}
            {!sweep && tab === "book" && (
              <div className="nb-body">
                {/* THE BACK OFFICE, offered where the pile is. */}
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
                      <p className="b">{n.body}</p>
                      <p className="w">{[n.trade, n.project, n.task, when(n.created_at)].filter(Boolean).join(" · ")}</p>
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
                    <p className="nb-card">{card.body}</p>
                    <p className="w">{[card.trade, card.project, card.task, when(card.created_at)].filter(Boolean).join(" · ")}</p>

                    {/* The one question a task cannot avoid, asked at the time
                        it is cheap to answer rather than while you were
                        writing it down. */}
                    {!card.project_id && (
                      <label className="nb-fld">
                        <span>Which job</span>
                        <select className="input" value={sweepJob} onChange={(e) => setSweepJob(e.target.value)}>
                          <option value="">Choose a job…</option>
                          {jobs.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
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
