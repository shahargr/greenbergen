"use client";

import { useMemo, useState } from "react";
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
// WHY IT IS ONLY PEOPLE ON YOUR PROJECTS. send_portal_message checks that
// both of you are on the project it is filed against, and that check is
// right: a message is about a job. Offering the whole contractor roster here
// would build a picker that mostly fails - and a back channel around the
// community price, which is the one thing the model does not want.
type Entry = { key: string; contact_id: string; project_id: string; name: string; seat: string | null; project_name: string };

export function Compose({ targets, base }: { targets: Target[]; base: string }) {
  const entries = useMemo<Entry[]>(
    () => targets.flatMap((t) => (t.people ?? []).map((p) => ({
      key: `${p.contact_id}|${t.project_id}`,
      contact_id: p.contact_id, project_id: t.project_id,
      name: p.name, seat: p.seat, project_name: t.project_name,
    }))),
    [targets],
  );
  // One person on two of your projects is two entries, so the label carries
  // the project - it is what makes them distinguishable, and it is what the
  // message will be filed against.
  const label = (e: Entry) => `${e.name}${e.seat ? ` · ${e.seat}` : ""} — ${e.project_name}`;
  const byLabel = useMemo(() => new Map(entries.map((e) => [label(e), e])), [entries]);

  const [typed, setTyped] = useState("");
  const picked = byLabel.get(typed.trim()) ?? null;

  if (entries.length === 0) {
    return (
      <p className="small text-muted" style={{ margin: 0 }}>
        Nobody to write to yet. A conversation starts when someone else is on one of your
        jobs — a contractor who accepted, or a person you invited.
      </p>
    );
  }

  return (
    <form action={messageSend} className="stack" style={{ gap: 10 }}>
      <input type="hidden" name="base" value={base} />
      {/* Both resolved from the one thing that was typed, so they can never
          disagree with each other or with what is on screen. */}
      <input type="hidden" name="to" value={picked?.contact_id ?? ""} />
      <input type="hidden" name="project" value={picked?.project_id ?? ""} />

      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">To</span>
        <input
          className="input" list="compose-people" autoComplete="off" placeholder="Start typing a name…"
          value={typed} onChange={(e) => setTyped(e.target.value)}
        />
        <datalist id="compose-people">
          {entries.map((e) => <option key={e.key} value={label(e)} />)}
        </datalist>
        <p className="hint">
          {picked
            ? `Filed against ${picked.project_name}.`
            : typed.trim()
              ? "Pick one from the list — that is how we know which job it is about."
              : `${entries.length} ${entries.length === 1 ? "person" : "people"} across your projects.`}
        </p>
      </label>

      <textarea name="body" className="input" rows={3} placeholder="What do you need to say?" required />
      <button className="btn btn-primary btn-block" disabled={!picked}>Send</button>
    </form>
  );
}
