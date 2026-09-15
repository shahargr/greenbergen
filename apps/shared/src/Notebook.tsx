"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";

// A NOTEBOOK, NOT A TASK LIST.
//
// Shahar (2026-09-15): "what i am missing as a contractor or even a home
// owner, is a list of things i'd like to get back to later on. like a
// notebook. with many notes on every trade engagement and project phase.
// something that would float on every screen allowing me to take a note. i
// would like to go back to notes as needed, and in some cases turn them into
// tasks, a thing that needs to be done."
//
// A task costs four decisions - who holds it, when it is due, what it
// delivers, which trade - and the moment writing a thought down costs four
// decisions, thoughts stop being written down. So this costs one: the words.
// Everything else is caught from where you were standing when you opened it,
// and a note becomes a task later, if it turns out to be one.
//
// Notes are PRIVATE. Not "private by default" - private, full stop, by a row
// policy rather than by this screen (migration 141). Nobody on the job reads
// them, and neither does a superadmin. That is the thing that makes a
// notebook safe to write the real sentence in rather than the diplomatic one.

type Note = {
  id: string;
  body: string;
  project_id: string | null;
  project: string | null;
  trade: string | null;
  action_id: string | null;
  task: string | null;
  screen: string | null;
  pinned: boolean;
  created_at: string;
  archived: boolean;
  became_action_id: string | null;
  became: string | null;
};

type Book = { notes: Note[]; open: number; here: number };

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

export function Notebook() {
  const path = usePathname() ?? "/";
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"write" | "book">("write");
  const [body, setBody] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [said, setSaid] = useState("");
  // Everything on this job, or only what was written right here. A trade
  // screen opens on "here" because that is why you are standing in it.
  const [scope, setScope] = useState<"here" | "all">("here");
  const box = useRef<HTMLTextAreaElement>(null);

  const at = whereFrom(path);
  // The login and join screens are not places you take notes, and the sheet
  // would sit on top of the one button there is.
  const hidden = /^\/(login|join|welcome|s)\b/.test(path);

  const read = useCallback(async () => {
    const { data, error } = await createClient().rpc("portal_notes", {
      p_project: scope === "here" ? at.project ?? null : null,
      p_trade: scope === "here" ? at.trade ?? null : null,
      p_show: "open",
    });
    if (error) { setErr(friendly(error.message)); return; }
    setBook(data as Book);
  }, [scope, at.project, at.trade]);

  // The count on the button is worth one small read on arrival - it is the
  // whole reason to look, and a notebook you have to open to discover is
  // empty is a notebook you stop opening.
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

  useEffect(() => { if (open && tab === "book") void read(); }, [open, tab, read]);
  useEffect(() => { if (open && tab === "write") box.current?.focus(); }, [open, tab]);

  // Escape closes it, because it is a sheet over whatever you were reading
  // and you did not come here to lose your place.
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  if (hidden) return null;

  async function save() {
    const text = body.trim();
    if (!text) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_note_add", {
      p_body: text,
      p_project: at.project ?? null,
      p_trade: at.trade ?? null,
      p_action: at.action ?? null,
      p_screen: path,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not written down."); return; }
    setBody("");
    setSaid(data.trade ? `Kept under ${data.trade}.` : data.project_id ? "Kept on this job." : "Kept.");
    setBook((b) => (b ? { ...b, open: b.open + 1, here: b.here + 1 } : b));
    box.current?.focus();
  }

  async function call(fn: string, args: Record<string, unknown>, ok: string) {
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc(fn, args);
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return null; }
    if (!data?.ok) { setErr(data?.reason ?? "That did not work."); return null; }
    setSaid(ok);
    await read();
    return data;
  }

  const notes = book?.notes ?? [];
  const count = book?.open ?? 0;

  return (
    <>
      {/* THE THING THAT FLOATS. One tap from anywhere, wearing how much is
          waiting - because a note you never look back at was not worth
          writing. It sits above the safe area so a phone's home bar does not
          eat it. */}
      <button type="button" className={`nb-fab${open ? " on" : ""}`}
        aria-label={count > 0 ? `Notebook — ${count} notes` : "Notebook"}
        onClick={() => { setOpen((o) => !o); setSaid(""); setErr(""); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 3h11a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
          <path d="M9 3v18M12 8h4M12 12h4" />
        </svg>
        {count > 0 && <span className="n">{count > 99 ? "99+" : count}</span>}
      </button>

      {open && (
        <>
          <button type="button" className="nb-scrim" aria-label="Close the notebook"
            onClick={() => setOpen(false)} />
          <div className="nb-sheet" role="dialog" aria-label="Notebook">
            <div className="nb-head">
              <div className="nb-tabs">
                <button type="button" className={tab === "write" ? "on" : ""}
                  onClick={() => setTab("write")}>Write</button>
                <button type="button" className={tab === "book" ? "on" : ""}
                  onClick={() => setTab("book")}>
                  Notebook{count > 0 ? ` · ${count}` : ""}
                </button>
              </div>
              <button type="button" className="nb-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            {tab === "write" ? (
              <div className="nb-body">
                <textarea ref={box} className="input nb-text" value={body} rows={5}
                  maxLength={4000}
                  onChange={(e) => { setBody(e.target.value); setSaid(""); }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !busy) { e.preventDefault(); void save(); }
                  }}
                  placeholder="Ask Javier whether the LVL at the landing needs a third jack stud — he said two on site, the plan shows three." />
                {/* WHERE IT WILL BE FILED, said before you write rather than
                    discovered afterwards. This is how "notes on every trade
                    engagement and project phase" happens without anybody
                    filing anything. */}
                <p className="nb-at">
                  {at.trade ? <>Filed under <strong>{at.trade}</strong></>
                    : at.action ? <>Kept against the task you&apos;re on</>
                    : at.project ? <>Kept on this job</>
                    : <>Kept in your notebook — no job attached</>}
                  {" · "}Only you can read it.
                </p>
                <div className="row" style={{ gap: 8 }}>
                  <button type="button" className="btn btn-primary grow" disabled={!body.trim() || busy}
                    onClick={() => { void save(); }}>
                    {busy ? "…" : "Keep this"}
                  </button>
                </div>
                {said && <p className="nb-ok">{said} It stays open — keep going.</p>}
                {err && <p className="nb-err">{err}</p>}
              </div>
            ) : (
              <div className="nb-body">
                {at.project && (
                  <div className="nb-scope">
                    <button type="button" className={scope === "here" ? "on" : ""}
                      onClick={() => setScope("here")}>
                      {at.trade ? at.trade : "This job"}
                    </button>
                    <button type="button" className={scope === "all" ? "on" : ""}
                      onClick={() => setScope("all")}>Everything</button>
                  </div>
                )}

                {notes.length === 0 && (
                  <p className="nb-none">
                    Nothing here yet. Whatever you want to come back to — write it on the other tab.
                  </p>
                )}

                <ul className="nb-list">
                  {notes.map((n) => (
                    <li key={n.id} className={`nb-note${n.pinned ? " pin" : ""}`}>
                      <p className="b">{n.body}</p>
                      <p className="w">
                        {[n.trade, n.project, n.task, when(n.created_at)].filter(Boolean).join(" · ")}
                      </p>
                      <div className="acts">
                        {/* THE ONE-WAY DOOR. "in some cases turn them into
                            tasks" - it lands on the job and the trade the
                            note was taken against, so it needs nothing said
                            about it here. A note with no job cannot become
                            work, and says so rather than failing. */}
                        <button type="button" disabled={busy || !n.project_id}
                          title={n.project_id ? undefined : "This note is not against a job"}
                          onClick={() => { void call("portal_note_to_task", { p_note: n.id }, "It is a task now."); }}>
                          Make it a task
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => { void call("portal_note_edit", { p_note: n.id, p_pinned: !n.pinned }, n.pinned ? "Unpinned." : "Pinned to the top."); }}>
                          {n.pinned ? "Unpin" : "Pin"}
                        </button>
                        <button type="button" disabled={busy}
                          onClick={() => { void call("portal_note_archive", { p_note: n.id }, "Put away — not deleted."); }}>
                          Done with it
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                {said && <p className="nb-ok">{said}</p>}
                {err && <p className="nb-err">{err}</p>}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
