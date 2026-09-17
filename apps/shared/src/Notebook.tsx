"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";
import { Evidence, type Attached } from "./Evidence";

// ONE BUTTON, TWO THINGS TO WRITE DOWN, THE PEOPLE TO RING - AND SOMETHING
// THAT GOES THROUGH THE NOTES LATER.
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
// And (2026-09-17): "remove order and book, but add phone book for project" /
// "todo can have an optional owner. me by default, but optional owner."
//
// TWO KINDS AND A PHONE BOOK. A to-do is work; an order is a thing arriving,
// and the only difference between the two in the database is
// actions.delivers - so an order is a to-do with one tick on it rather than
// a tab of its own. A note is neither. The phone book is the third tab
// because "what is the plumber's number" is the question asked most often
// standing on a site, and it was four screens away.
//
// THE BOOK IS STILL HERE, off the tab strip: what was kept and the
// end-of-day sweep live behind one line at the foot of the sheet, because
// "Book" as a tab meant nothing to the person it was for.
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
// Who can hold a to-do on a job (portal_compose_targets: the seats on it, `me` marked).
type Person = { contact_id: string; name: string | null; seat: string | null; me?: boolean };
type Crew = { project_id: string; people: Person[] };
// THE KINDS OF TASK THAT REPEAT (migration 172). Shahar (2026-09-17): "i am
// seeing myself creating similar tasks and go through the entire process
// every time." A kind is a recipe: it says what the sheet asks for - two or
// three things - and the database names the task, fills its columns and
// says what closes it. "note" is the plain kind the sheet always had.
type Kind = {
  kind: string; label: string; sentence: string; hint: string | null;
  asks: string[]; closes_with: string | null; follow: string | null;
};
type Stage = { stage: string; description: string | null };
type Kinds = { kinds: Kind[]; stages: Stage[] };
// The trade catalogue seen from the chosen job (migration 170): the trades
// on the job first, the rest of the build behind them.
type CatTrade = { trade: string; stage: string | null; panel: string; on_job: boolean };
// One line of the phone book (migration 161).
type Entry = {
  contact_id: string; name: string | null; company: string | null;
  phone: string | null; phone_2: string | null; email: string | null;
  seat: string | null; trade: string | null; me: boolean;
};

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

// A phone number as something a phone can dial, whatever punctuation it was
// typed with. The screen shows it as typed.
const dial = (p: string) => p.replace(/[^\d+]/g, "");

// ONE THING TO WRITE DOWN (Shahar, 2026-09-17: "merge todo and note. the
// only difference is who should hold it, so make it optional. leave it on
// logged user as default"). A note on a job is a task on the job, held by
// you unless you name somebody; a note with no job is held in the notebook
// until the evening sweep asks which job. "Under which task" is gone too -
// "let's keep it to higher level - the project level" - and so is the order
// tick, whose wording read as a purchase.
export type NotebookTab = "note" | "phone";

// OPENED FROM ELSEWHERE. The project screen's panel (2026-09-17) opens the
// sheet on a tab with the job already chosen; a plain event keeps the two
// apart - the panel is a server page with buttons, the sheet is this one
// client component in the layout, and neither imports the other.
export type NotebookOpen = { tab?: NotebookTab; job?: string };
const OPEN_EVENT = "gb:notebook";
export function openNotebook(detail: NotebookOpen = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<NotebookOpen>(OPEN_EVENT, { detail }));
}

type Tab = NotebookTab | "book";

const HINT = "Ask Javier whether the LVL at the landing needs a third jack stud — he said two on site, the plan shows three.";

export function Notebook({ payPath = null }: {
  /** Where "Pay" goes, with {job} standing for the job's id - the app that
   *  has a payment screen says so; the one that does not shows no Pay. */
  payPath?: string | null;
}) {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("note");
  const [body, setBody] = useState("");
  const [due, setDue] = useState("");
  const [job, setJob] = useState("");
  // WHO HOLDS IT. "me by default, but optional owner." Empty means me; the
  // select offers the seats on the chosen job.
  const [owner, setOwner] = useState("");
  const [jobTouched, setJobTouched] = useState(false);
  // WHICH KIND OF THING. "note" is the plain one; the rest come from the
  // database with what each asks for.
  const [kind, setKind] = useState("note");
  const [kinds, setKinds] = useState<Kinds>({ kinds: [], stages: [] });
  const [cat, setCat] = useState<CatTrade[]>([]);
  const [trade, setTrade] = useState("");
  const [stage, setStage] = useState("");
  const [gate, setGate] = useState(false);
  const [cost, setCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [tradesPicked, setTradesPicked] = useState<string[]>([]);
  const [files, setFiles] = useState<Attached[]>([]);
  // Files taken before a job was picked, still in the browser (Evidence
  // holds them and sends them up when the job arrives).
  const [heldN, setHeldN] = useState(0);
  const [book, setBook] = useState<Book | null>(null);
  const [targets, setTargets] = useState<Targets>({ projects: [], tasks: [] });
  const [crews, setCrews] = useState<Crew[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  const [scope, setScope] = useState<"here" | "all">("here");
  const [sweep, setSweep] = useState<Note[] | null>(null);
  const [at, setAt] = useState(0);
  const [sweepJob, setSweepJob] = useState("");
  // The phone book of the chosen job, and a few letters to narrow it.
  const [phone, setPhone] = useState<Entry[] | null>(null);
  const [find, setFind] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const here = whereFrom(path);
  const hidden = /^\/(login|join|welcome|s)\b/.test(path);

  // Where you are standing wins until you say otherwise - and saying
  // otherwise sticks, because filing three things for one job should not mean
  // picking it three times.
  useEffect(() => {
    if (!jobTouched) setJob(here.project ?? "");
  }, [here.project, jobTouched]);

  // One read on arrival: the count the button wears, the jobs the pickers
  // need before they can ask anything, and who sits on each of them.
  useEffect(() => {
    let live = true;
    void (async () => {
      const c = createClient();
      const [b, t, p, k] = await Promise.all([
        c.rpc("portal_notes", { p_project: null, p_trade: null, p_show: "open", p_limit: 0 }),
        c.rpc("portal_capture_targets", { p_project: null }),
        c.rpc("portal_compose_targets"),
        c.rpc("portal_task_kinds"),
      ]);
      if (!live) return;
      if (b.data) setBook((x) => x ?? (b.data as Book));
      if (t.data) setTargets(t.data as Targets);
      if (Array.isArray(p.data)) setCrews(p.data as Crew[]);
      if (k.data && Array.isArray((k.data as Kinds).kinds)) setKinds(k.data as Kinds);
    })();
    return () => { live = false; };
  }, []);

  // The owner goes back to "me" with the job: a name from the last job is
  // not a choice on this one. The trade picks go with it.
  useEffect(() => { setOwner(""); setTrade(""); setTradesPicked([]); }, [job]);

  // THE TRADES OF THE JOB, read once a kind that asks for one is chosen -
  // the catalogue is seventy-odd rows and most notes never need it.
  const recipe = kinds.kinds.find((k) => k.kind === kind) ?? null;
  const asks = (f: string) => !!recipe && recipe.asks.includes(f);
  const wantsTrades = asks("trade") || asks("trades");
  useEffect(() => {
    if (!open || !job || !wantsTrades) return;
    let live = true;
    void (async () => {
      const { data } = await createClient().rpc("portal_trade_catalogue", { p_project: job });
      if (live && Array.isArray(data)) setCat(data as CatTrade[]);
    })();
    return () => { live = false; };
  }, [open, job, wantsTrades]);

  // THE PHONE BOOK follows the job too, and only when it is being looked at.
  useEffect(() => {
    if (!open || tab !== "phone") return;
    if (!job) { setPhone(null); return; }
    let live = true;
    setPhone(null);
    void (async () => {
      const { data, error } = await createClient().rpc("portal_project_phone_book", { p_project: job });
      if (!live) return;
      if (error) { setErr(friendly(error.message)); return; }
      setPhone(Array.isArray(data?.people) ? (data.people as Entry[]) : []);
    })();
    return () => { live = false; };
  }, [open, tab, job]);

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
  useEffect(() => { if (open && tab === "note") box.current?.focus(); }, [open, tab]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { if (sweep) setSweep(null); else setOpen(false); } };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open, sweep]);

  // Opened by name from a screen (openNotebook): the tab and the job, set
  // before the sheet appears.
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<NotebookOpen>).detail ?? {};
      if (d.job) { setJob(d.job); setJobTouched(true); }
      if (d.tab) setTab(d.tab);
      setSaid(""); setErr(""); setSweep(null);
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, on);
    return () => window.removeEventListener(OPEN_EVENT, on);
  }, []);

  if (hidden) return null;

  const jobs = targets.projects;
  const jobName = jobs.find((j) => j.id === job)?.name ?? null;
  const ids = files.map((f) => f.id);
  const crew = crews.find((c) => c.project_id === job)?.people ?? [];
  const myself = crew.find((p) => p.me) ?? null;

  function clear(msg: string) {
    setBody(""); setDue(""); setFiles([]); setOwner(""); setSaid(msg); box.current?.focus();
    setCost(""); setSupplier(""); setStage(""); setGate(false); setTradesPicked([]);
  }

  // The trades the pickers offer: on the job first, then the rest of the
  // build - and, standing on a trade, that one already chosen.
  const onJob = cat.filter((t) => t.on_job);
  const offJob = cat.filter((t) => !t.on_job);
  const tradeChosen = trade || (here.trade && cat.some((t) => t.trade === here.trade) ? here.trade : "");
  const payHref = payPath && job ? payPath.replace("{job}", job) : null;

  // ONE THING WRITTEN DOWN. With a job it is a task, now, on the job, held
  // by you unless you named somebody. Without one it is held as a capture
  // and comes back tonight, which beats refusing to write it down and beats
  // guessing a job.
  async function keep() {
    const text = body.trim();
    if (!text && ids.length === 0) return;
    setBusy(true); setErr("");
    const c = createClient();

    // A KIND: the recipe writes the task (portal_task_from_kind, 172). Two
    // or three answers here; the name, the columns and what closes it are
    // the database's.
    if (job && kind !== "note" && recipe) {
      const { data, error } = await c.rpc("portal_task_from_kind", {
        p_project: job,
        p_kind: kind,
        p_fields: {
          what: (text.split("\n")[0] || "").slice(0, 300),
          trade: asks("trade") ? tradeChosen || null : null,
          trades: asks("trades") ? tradesPicked : null,
          when: due || null,
          who: owner || myself?.contact_id || null,
          cost: asks("cost") && cost.trim() ? Number(cost.replace(/[^0-9.]/g, "")) : null,
          supplier: asks("supplier") ? supplier.trim() || null : null,
          stage: asks("stage") ? stage || null : null,
          gate: asks("gate") ? gate : false,
          file_ids: ids.length ? ids : null,
        },
      });
      setBusy(false);
      if (error) { setErr(friendly(error.message)); return; }
      if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
      const n = Number(data.children ?? 0);
      clear(`${data.action ?? "Added"}${n > 0 ? ` — ${n} step${n === 1 ? "" : "s"} under it` : ""}${jobName ? ` — ${jobName}` : ""}.`);
      return;
    }

    if (job) {
      const { data, error } = await c.rpc("portal_task_quick", {
        p_project: job,
        p_action: (text.split("\n")[0] || "Something to do").slice(0, 300),
        p_trade: here.trade ?? null,
        p_target_date: due || null,
        // Me unless somebody else was named: the database reads "nobody
        // named" as the person logging it.
        p_assignee: owner || myself?.contact_id || null,
        p_file_ids: ids.length ? ids : null,
      });
      setBusy(false);
      if (error) { setErr(friendly(error.message)); return; }
      if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
      clear(`On the board${jobName ? ` — ${jobName}` : ""}.`);
      return;
    }

    const { data, error } = await c.rpc("portal_note_add", {
      p_body: text,
      p_project: null,
      p_trade: here.trade ?? null,
      p_action: null,
      p_screen: path,
      p_intent: "task",
      p_file_ids: ids.length ? ids : null,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not written down."); return; }
    setBook((b) => (b ? { ...b, open: b.open + 1, to_sweep: b.to_sweep + 1 } : b));
    clear("Held — you'll be asked which job tonight.");
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
          {"  ".repeat(j.depth)}{j.depth > 0 ? "└ " : ""}{j.name}
        </option>
      ))}
    </>
  );

  // The phone book, narrowed by a few letters against everything on the
  // line - name, company, seat, trade - because "the guy from Kuiken" is how
  // people are remembered on a site.
  const q = find.trim().toLowerCase();
  const listed = (phone ?? []).filter((p) => !q
    || [p.name, p.company, p.seat, p.trade].some((s) => (s ?? "").toLowerCase().includes(q)));

  return (
    <>
      <button type="button" className={`nb-fab${open ? " on" : ""}`}
        aria-label={count > 0 ? `Notebook — ${count} kept` : "Write something down"}
        onClick={() => { setOpen((o) => !o); setSaid(""); setErr(""); setSweep(null); if (tab === "book") setTab("note"); }}>
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
              ) : tab === "book" ? (
                <>
                  <button type="button" className="nb-back" onClick={() => setTab("note")}>‹ Back</button>
                  <span className="nb-title">Kept{count > 0 ? ` · ${count}` : ""}</span>
                </>
              ) : (
                <div className="nb-tabs">
                  <button type="button" className={tab === "note" ? "on" : ""}
                    onClick={() => { setTab("note"); setSaid(""); setErr(""); }}>Note</button>
                  <button type="button" className={tab === "phone" ? "on" : ""}
                    onClick={() => { setTab("phone"); setSaid(""); setErr(""); }}>
                    Phone book
                  </button>
                </div>
              )}
              <button type="button" className="nb-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            {/* ── THE CAPTURE SHEET. One shape for both kinds, which is what
                "have the same size of screen" asks for: the body keeps a
                floor so the sheet does not jump as you move between tabs. ── */}
            {!sweep && tab === "note" && (
              <div className="nb-body nb-capture">
                {/* WHICH KIND. Note, then the recipes (migration 172); Pay is
                    a link to the payment screen where the app has one. */}
                {kinds.kinds.length > 0 && (
                  <div className="nb-kinds" role="tablist" aria-label="What kind of thing">
                    <button type="button" className={kind === "note" ? "on" : ""}
                      onClick={() => { setKind("note"); setSaid(""); setErr(""); }}>Note</button>
                    {kinds.kinds.filter((k) => k.kind !== "pay").map((k) => (
                      <button key={k.kind} type="button" className={kind === k.kind ? "on" : ""}
                        title={k.sentence}
                        onClick={() => { setKind(k.kind); setSaid(""); setErr(""); box.current?.focus(); }}>
                        {k.label}
                      </button>
                    ))}
                    {payHref && <a className="pay" href={payHref}>Pay</a>}
                  </div>
                )}
                {recipe && (
                  <p className="nb-sentence">{recipe.sentence}{recipe.hint ? <span className="text-muted"> · {recipe.hint}</span> : null}</p>
                )}

                <textarea ref={box} className="input nb-text" value={body}
                  rows={recipe ? 2 : 4} maxLength={4000}
                  onChange={(e) => { setBody(e.target.value); setSaid(""); }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) { e.preventDefault(); void keep(); }
                  }}
                  placeholder={
                    kind === "check" ? "What should be true on site — e.g. the shower niche is framed on both sides"
                    : kind === "deliver" ? "What is coming — e.g. 40 stair treads, white oak"
                    : kind === "document" ? "What to record — e.g. plumbing rough-in, master bath, before the walls close"
                    : kind === "gather" ? "What to collect — e.g. warranties on labour and parts"
                    : kind === "buy" ? "What to buy — e.g. a 75-gallon water heater"
                    : HINT} />

                {/* WHAT THE KIND ASKS, and nothing it does not. */}
                {recipe && (asks("trade") || asks("stage") || asks("cost") || asks("supplier")) && (
                  <div className="nb-two">
                    {asks("trade") && (
                      <label className="nb-fld">
                        <span>Trade{kind === "check" ? " · whose work" : kind === "buy" || kind === "deliver" ? " (optional)" : ""}</span>
                        <select className="input" value={tradeChosen} onChange={(e) => setTrade(e.target.value)} disabled={!job}>
                          <option value="">{job ? (kind === "check" || kind === "document" ? "Choose a trade…" : "No trade") : "Pick a job first"}</option>
                          {onJob.length > 0 && <optgroup label="On this job">{onJob.map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}</optgroup>}
                          {offJob.length > 0 && <optgroup label="Elsewhere in the build">{offJob.map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}</optgroup>}
                        </select>
                      </label>
                    )}
                    {asks("stage") && (
                      <label className="nb-fld">
                        <span>Stage</span>
                        <select className="input" value={stage} onChange={(e) => setStage(e.target.value)}>
                          <option value="">Which stage…</option>
                          {kinds.stages.map((s) => <option key={s.stage} value={s.stage} title={s.description ?? undefined}>{s.stage}</option>)}
                        </select>
                      </label>
                    )}
                    {asks("cost") && (
                      <label className="nb-fld">
                        <span>About how much</span>
                        <input className="input" inputMode="decimal" placeholder="$" value={cost} onChange={(e) => setCost(e.target.value)} />
                      </label>
                    )}
                    {asks("supplier") && (
                      <label className="nb-fld">
                        <span>From whom</span>
                        <input className="input" placeholder="Kuiken, Home Depot, …" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
                      </label>
                    )}
                  </div>
                )}
                {asks("gate") && (
                  <label className="nb-tick">
                    <input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} />
                    <span>Nothing closes over it until this exists{tradeChosen ? ` — holds ${tradeChosen.toLowerCase()}` : ""}</span>
                  </label>
                )}
                {asks("trades") && job && (
                  <div className="nb-fld">
                    <span>From which trades</span>
                    <div className="nb-chips">
                      {(onJob.length > 0 ? onJob : offJob).map((t) => {
                        const on = tradesPicked.includes(t.trade);
                        return (
                          <button key={t.trade} type="button" className={`tag ${on ? "" : "tag-neutral"}`}
                            onClick={() => setTradesPicked((p) => on ? p.filter((x) => x !== t.trade) : [...p, t.trade])}>
                            {t.trade}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="nb-two">
                  <label className="nb-fld">
                    <span>Which job</span>
                    <select className="input" value={job}
                      onChange={(e) => { setJob(e.target.value); setJobTouched(true); setSaid(""); }}>
                      {jobOptions(true)}
                    </select>
                  </label>
                  <label className="nb-fld">
                    <span>When</span>
                    <input className="input" type="date" value={due}
                      onChange={(e) => setDue(e.target.value)} disabled={!job} />
                  </label>
                </div>

                {/* WHO HOLDS IT (Shahar, 2026-09-17: "the only difference is
                    who should hold it, so make it optional. leave it on
                    logged user as default"). The seats on the job, yours
                    first and already chosen. */}
                {job && crew.length > 0 && (
                  <label className="nb-fld">
                    <span>Who holds it <span className="text-muted">(optional)</span></span>
                    <select className="input" value={owner} onChange={(e) => setOwner(e.target.value)}>
                      <option value="">{myself ? `${myself.name ?? "Me"} (me)` : "Me"}</option>
                      {crew.filter((p) => !p.me).map((p) => (
                        <option key={p.contact_id} value={p.contact_id}>
                          {p.name}{p.seat ? ` · ${p.seat}` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {/* "Under which task" and the order tick are gone (Shahar,
                    2026-09-17): a note lands on the job, and the language
                    of ordering read as a purchase. */}

                {/* CAMERA, FILE OR IMAGE, VOICE - the same three as on a
                    task. Evidence takes the file first and holds it in the
                    browser; the moment a job is chosen it goes up under that
                    job. What it cannot do is keep a file with NO job - there
                    is nowhere in the store for it - so a held file turns
                    "Hold it for tonight" into a request for the job. */}
                <Evidence projectId={job || null} caption="Capture" folder="notes"
                  accept="image/*,video/*,audio/*,application/pdf"
                  onChange={setFiles} onHeld={setHeldN} />

                <p className="nb-at">
                  {job && recipe
                    ? <>
                        {kind === "check" && <>A task to check it{tradeChosen ? <> on <strong>{tradeChosen}</strong></> : null}, held by {owner ? crew.find((p) => p.contact_id === owner)?.name ?? "them" : "you"}. It closes with a photo and a yes or no.</>}
                        {kind === "deliver" && <>Tracked from ordered to on site, held by {owner ? crew.find((p) => p.contact_id === owner)?.name ?? "them" : "you"}. It closes with a photo of it there.</>}
                        {kind === "document" && <>A record to take{stage ? <> at <strong>{stage.toLowerCase()}</strong></> : null}{tradeChosen ? <> on <strong>{tradeChosen}</strong></> : null}. It closes when the media is attached{gate ? ", and holds the trade until then" : ""}.</>}
                        {kind === "gather" && <>One step per contract in {tradesPicked.length > 0 ? <strong>{tradesPicked.join(", ")}</strong> : "the trades you pick"}, each closing when its file is attached.</>}
                        {kind === "buy" && <>A purchase to make{cost.trim() ? <>, about <strong>${cost.replace(/[^0-9.]/g, "")}</strong></> : null}. Log the payment against it; paid, a Deliver task follows by itself.</>}
                      </>
                    : job
                    ? <>Goes straight on the board{here.trade ? <> under <strong>{here.trade}</strong></> : null}, held by {owner ? crew.find((p) => p.contact_id === owner)?.name ?? "them" : "you"}. The people on the job can see it.</>
                    : recipe
                    ? <>Pick a job above — a {recipe.label.toLowerCase()} task belongs to one.</>
                    : heldN > 0
                      ? <>Pick a job above and {heldN === 1 ? "the file goes" : "the files go"} on it with this. Without a job there is nowhere to keep {heldN === 1 ? "it" : "them"}.</>
                      : <>No job yet, so it is held in your notebook and the end-of-day sweep asks which one.</>}
                </p>

                <button type="button" className="btn btn-primary"
                  disabled={(!body.trim() && ids.length === 0) || busy || (!job && heldN > 0) || (!!recipe && !job)
                    || (kind === "document" && !stage) || (kind === "gather" && tradesPicked.length === 0)}
                  onClick={() => { void keep(); }}>
                  {busy ? "…"
                    : recipe && !job ? "Pick a job first"
                    : kind === "document" && !stage ? "Pick a stage"
                    : kind === "gather" && tradesPicked.length === 0 ? "Pick the trades"
                    : recipe ? `Add the ${recipe.label.toLowerCase()} task`
                    : !job && heldN > 0 ? "Pick a job first" : !job ? "Hold it for tonight" : "Add it"}
                </button>
                {said && <p className="nb-ok">{said} Still open — keep going.</p>}
                {err && <p className="nb-err">{err}</p>}

                {/* WHAT WAS KEPT, one line, and the way to go through it.
                    The Book tab is gone (Shahar: "not sure what is book");
                    the notes and the end-of-day sweep are still here. */}
                {(count > 0 || waiting > 0) && (
                  <button type="button" className="nb-kept" onClick={() => { setTab("book"); setSaid(""); setErr(""); }}>
                    <span className="grow">
                      {count} kept{waiting > 0 ? ` · ${waiting} to go through` : ""}
                    </span>
                    <span className="go">Open ›</span>
                  </button>
                )}
              </div>
            )}

            {/* ── THE PHONE BOOK (migration 161). Everybody with a reason to
                be rung about this job - the seats on it and above it, the
                parties to its contracts - with a number you can tap. ── */}
            {!sweep && tab === "phone" && (
              <div className="nb-body nb-capture">
                <label className="nb-fld">
                  <span>Which job</span>
                  <select className="input" value={job}
                    onChange={(e) => { setJob(e.target.value); setJobTouched(true); }}>
                    {jobOptions(false)}
                  </select>
                </label>
                {job && (phone?.length ?? 0) > 6 && (
                  <input className="input" value={find} onChange={(e) => setFind(e.target.value)}
                    placeholder="A name, a company, a trade…" aria-label="Find somebody" />
                )}
                {!job && <p className="nb-none">Pick a job and everybody on it is here, with their number.</p>}
                {job && phone === null && !err && <p className="nb-none">Looking them up…</p>}
                {job && phone && phone.length === 0 && <p className="nb-none">Nobody is on this job yet.</p>}
                {job && phone && phone.length > 0 && listed.length === 0 && (
                  <p className="nb-none">Nobody on this job matches “{find.trim()}”.</p>
                )}
                <ul className="nb-phone">
                  {listed.map((p) => (
                    <li key={p.contact_id} className={p.me ? "me" : undefined}>
                      <span className="who">
                        <span className="t">{p.name ?? p.company ?? "—"}{p.me ? " · you" : ""}</span>
                        <span className="m">
                          {[p.company && p.company !== p.name ? p.company : null, p.trade, p.seat]
                            .filter(Boolean).join(" · ") || "on this job"}
                        </span>
                      </span>
                      <span className="ways">
                        {p.phone
                          ? <>
                              <a href={`tel:${dial(p.phone)}`} title={p.phone}>Call</a>
                              <a href={`sms:${dial(p.phone)}`} title={p.phone}>Text</a>
                            </>
                          : <span className="none">no number</span>}
                        {p.email && <a href={`mailto:${p.email}`} title={p.email}>Email</a>}
                      </span>
                    </li>
                  ))}
                </ul>
                {err && <p className="nb-err">{err}</p>}
              </div>
            )}

            {/* ── THE BOOK: what was kept, behind the line at the foot. ── */}
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
                      onClick={() => { setSweep(null); setTab("book"); }}>Back to what was kept</button>
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
