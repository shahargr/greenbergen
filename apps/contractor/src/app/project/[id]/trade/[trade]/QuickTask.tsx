"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { Evidence, type Attached } from "@shared/Evidence";
import { ChevronIcon } from "@shared/ui";
import { GateMark } from "@/components/GateMark";

// TWO KINDS OF WRITING-DOWN, AND THEY ARE NOT THE SAME ACT.
//
// Shahar (2026-09-15): "you need to be able to either do like a subtask, which
// is simple, versus the new task, which is a big one with all the different
// steps... Simple task is task that you cannot have any child to, for example.
// It inherits the trade and all that information, so it's kind of
// pre-populated. A complex task is when you have it all."
//
// "Call the framer about the landing" is a note to yourself. "Internal stairs"
// is a package of work with a scope, a contract, a payee and four steps.
// Making the first cost the second's three passes is how a thought that took
// four seconds to have stops being written down at all.
//
// So: a line and a button, here, where you are already looking at the trade.
// It stays put and clears itself, because the reason you are in this box is
// that you thought of three things at once. The wizard is one tap away for
// the other kind, and says which kind it is.
//
// FOLDED UNTIL WANTED, WITH THE PROOF BUTTONS INSIDE. Shahar (2026-09-16):
// "the log a task panel should not be open by default, only when opening it.
// on desktop it should also allow to upload evidence with drag/drop. in
// addition, all interfaces should be able to attach or take photo, record
// voice, and write note." The box was the tallest thing on a trade screen
// you open to READ - open work, late work, who is here - and it was a box
// for writing. One row now, and inside it the same three-across proof row
// every other writing surface has (Evidence): drop / attach / voice at a
// desk, photo / file / voice on a phone. The line you type is the note.
export function QuickTask({ projectId, projectName, trade, elsewhere }: {
  /** The job the task lands on - a property holds no work, its jobs do. */
  projectId: string;
  projectName: string | null;
  trade: string;
  /** Said only when the job is not the one whose screen this is. */
  elsewhere: boolean;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [added, setAdded] = useState<string[]>([]);
  // "this must come first for the rest to resume" (Shahar, 2026-09-16)
  const [gate, setGate] = useState(false);
  const [files, setFiles] = useState<Attached[]>([]);
  // Bumped after each add so the Evidence block remounts empty: its
  // attachments belong to the task just written, not the next one.
  const [round, setRound] = useState(0);

  const ready = name.trim().length > 0;

  async function add() {
    if (!ready) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_task_quick", {
      p_project: projectId,
      p_action: name.trim(),
      p_trade: trade,
      p_target_date: due || null,
      p_is_gate: gate,
      p_file_ids: files.length > 0 ? files.map((f) => f.id) : null,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
    setAdded((list) => [...list, data.action as string]);
    setName(""); setDue(""); setGate(false); setFiles([]); setRound((n) => n + 1);
    router.refresh();
  }

  return (
    <details className="home-panel">
      <summary className="home-row">
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">Log a {trade.toLowerCase()} task</span>
          <span className="m" style={{ display: "block" }}>
            One line, a date if you know it, a photo or a voice note if you have one
          </span>
        </span>
        <span className="chev"><ChevronIcon /></span>
      </summary>

      <div className="drawer stack" style={{ gap: 8, paddingTop: 10 }}>
        <div className="row" style={{ gap: 8, alignItems: "flex-start" }}>
          <input className="input grow" style={{ minWidth: 0 }} value={name} maxLength={300}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && ready && !busy) { e.preventDefault(); void add(); } }}
            placeholder={`Call the framer about the landing`} aria-label={`A ${trade.toLowerCase()} task`} />
          <button type="button" className="btn btn-primary" style={{ flex: "none", minHeight: 44 }}
            disabled={!ready || busy} onClick={() => { void add(); }}>
            {busy ? "…" : "Add"}
          </button>
        </div>

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)}
            aria-label="When it is due" style={{ maxWidth: 190 }} />
          <span className="tiny text-muted">When, if you know.</span>
        </div>

        {/* THE PROOF, THE SAME WAY EVERYWHERE. Uploads as it goes; the ids ride
            along with the line when Add is pressed, and the database links them
            to the task (migration 145). */}
        <Evidence key={round} projectId={projectId} caption={`${trade} task`} onChange={setFiles} />

        {/* A GATE, IN ONE TICK RATHER THAN FOUR VISITS.
            Shahar (2026-09-16): "allow me to check a box stating this must come
            first for the rest to resume, with high priority. so this task become
            a gate in a way."

            Real dependencies exist (migration 130: after, before, parent) and
            almost nobody will ever use them, because saying "this blocks those
            four" means opening four tasks and pointing each one back here. This
            says the same thing in one tick: everything in this trade waits on
            me. High priority comes with it rather than being a second decision -
            a thing the rest of the job is waiting on IS the urgent one. */}
        <label className="gate-tick">
          <input type="checkbox" checked={gate} onChange={(e) => setGate(e.target.checked)} />
          <span className="grow">
            <span className="t">This must come first</span>
            <span className="m">
              Nothing else in {trade.toLowerCase()} moves until it is done. Logged as a gate, high priority.
            </span>
          </span>
          {gate && <GateMark label={false} />}
        </label>

        <p className="tiny text-muted" style={{ margin: 0 }}>
          Filed under <strong>{trade}</strong>
          {elsewhere && projectName ? <> on <strong>{projectName}</strong></> : null}
          . A simple task: one line, no steps under it.{" "}
          {/* THE OTHER KIND, named so the choice is visible rather than hidden
              behind knowing which button is which. */}
          <Link href={`/project/${projectId}/task/new?trade=${encodeURIComponent(trade)}&back=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname + window.location.search)}`}
            style={{ fontWeight: 700 }}>
            Needs steps?
          </Link>{" "}
          is for work with a scope, a contract and a price.
        </p>

        {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
        {added.length > 0 && (
          <p className="tiny" style={{ color: "var(--color-ok)", margin: 0 }}>
            Added {added.length === 1 ? <>“{added[0]}”</> : `${added.length} tasks`}. Keep going — it stays open.
          </p>
        )}
      </div>
    </details>
  );
}
