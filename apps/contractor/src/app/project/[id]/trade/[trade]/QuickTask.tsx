"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";

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

  const ready = name.trim().length > 0;

  async function add() {
    if (!ready) return;
    setBusy(true); setErr("");
    const { data, error } = await createClient().rpc("portal_task_quick", {
      p_project: projectId,
      p_action: name.trim(),
      p_trade: trade,
      p_target_date: due || null,
    });
    setBusy(false);
    if (error) { setErr(friendly(error.message)); return; }
    if (!data?.ok) { setErr(data?.reason ?? "That was not added."); return; }
    setAdded((list) => [...list, data.action as string]);
    setName(""); setDue("");
    router.refresh();
  }

  return (
    <div className="card pad stack" style={{ gap: 8 }}>
      <div className="between" style={{ alignItems: "baseline", gap: 10 }}>
        <span className="small" style={{ fontWeight: 700 }}>Log a {trade.toLowerCase()} task</span>
        {/* THE OTHER KIND, named so the choice is visible rather than hidden
            behind knowing which button is which. */}
        <Link href={`/project/${projectId}/task/new?trade=${encodeURIComponent(trade)}&back=${encodeURIComponent(typeof window === "undefined" ? "/" : window.location.pathname + window.location.search)}`}
          className="small" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
          Needs steps?
        </Link>
      </div>

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

      <p className="tiny text-muted" style={{ margin: 0 }}>
        Filed under <strong>{trade}</strong>
        {elsewhere && projectName ? <> on <strong>{projectName}</strong></> : null}
        . A simple task: one line, no steps under it. Use <em>Needs steps?</em> for work with a scope,
        a contract and a price.
      </p>

      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      {added.length > 0 && (
        <p className="tiny" style={{ color: "var(--color-ok)", margin: 0 }}>
          Added {added.length === 1 ? <>“{added[0]}”</> : `${added.length} tasks`}. Keep going — it stays open.
        </p>
      )}
    </div>
  );
}
