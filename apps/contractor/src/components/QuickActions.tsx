"use client";

import Link from "next/link";

// THE THINGS YOU DO ON A JOB MOST DAYS, in one panel at the top of it.
//
// Shahar (2026-09-17), on the band that said "You run this · In progress ·
// Active / 55 Walnut Drive": "replace this panel with new panel, allowing to
// perform the most repeatable tasks in a project. which tasks you think
// should be here: daily site visit, order something, todo and/take note."
//
// The band said three things you already knew and did nothing. This does
// the day's work: log the visit, write down a to-do, order a thing, keep a
// note, find somebody's number, and - for whoever runs the job - a full task,
// a payment, an award. Each is one tap. The status line the band carried is
// kept as a caption, small, because it is still true and costs one line.
//
// Then (2026-09-17, later): "the note and phone book on top is redundant to
// the floating icon. instead, add an AI button that will start a process
// that takes tasks without trade or assignee, one by one to fix and sort."
// So: Site visit, Tidy up, Full task, Log payment, Award work. The notebook
// button floats over every screen and does the note and the phone book.
type Props = {
  /** "You run this · In Progress · Active" - what the band used to say. */
  standing: string;
  /** The address, or the parent's name, or nothing. */
  where: string | null;
  visitHref: string | null;
  visitsToday: number;
  /** The tidy-up process (migration 173), and how many tasks wait in it. */
  tidyHref: string | null;
  tidyCount: number;
  addTaskHref: string | null;
  payHref: string | null;
  awardHref: string | null;
};

const g = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const Pin = () => <svg {...g}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
// The tidy-up: a sparkle, the sign every phone uses for "let it sort this".
const Sparkle = () => <svg {...g}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>;
const Plus = () => <svg {...g}><path d="M12 5v14M5 12h14" /></svg>;
const Dollar = () => <svg {...g}><path d="M12 3v18M16.5 7.5a3.5 3.5 0 0 0-3.5-2h-2a3 3 0 0 0 0 6h2a3 3 0 0 1 0 6h-2a3.5 3.5 0 0 1-3.5-2" /></svg>;
const Award = () => <svg {...g}><path d="M12 3v5M7.5 8L3 15h9zM16.5 8L12 15h9zM3 15a4.5 4.5 0 0 0 9 0M12 15a4.5 4.5 0 0 0 9 0M8 21h8M12 8v13" /></svg>;

export function QuickActions({ standing, where, visitHref, visitsToday, tidyHref, tidyCount, addTaskHref, payHref, awardHref }: Props) {
  return (
    <section className="qa">
      <div className="qa-head">
        <span className="what">{standing}</span>
        {where && <span className="where">{where}</span>}
      </div>
      <div className="qa-grid">
        {visitHref && (
          <Link href={visitHref} className="qa-btn">
            <Pin /><span>Site visit</span>
            {visitsToday > 0 && <span className="n">{visitsToday} today</span>}
          </Link>
        )}
        {/* THE TIDY-UP. One task at a time, of the ones with no trade or no
            holder, with a guess to accept (migration 173). The count is the
            pile; it is the button's reason to exist. */}
        {tidyHref && (
          <Link href={tidyHref} className="qa-btn">
            <Sparkle /><span>Tidy up</span>
            {tidyCount > 0 && <span className="n">{tidyCount}</span>}
          </Link>
        )}
        {addTaskHref && (
          <Link href={addTaskHref} className="qa-btn">
            <Plus /><span>Full task</span>
          </Link>
        )}
        {payHref && (
          <Link href={payHref} className="qa-btn">
            <Dollar /><span>Log payment</span>
          </Link>
        )}
        {awardHref && (
          <Link href={awardHref} className="qa-btn">
            <Award /><span>Award work</span>
          </Link>
        )}
      </div>
    </section>
  );
}
