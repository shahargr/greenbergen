"use client";

import Link from "next/link";
import { openNotebook } from "@shared/Notebook";

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
// The first five open the notebook sheet on the right tab with this job
// already chosen (openNotebook); the rest are the screens that already exist.
// Nothing here is new capability - it is the existing capability at the
// distance it should have been at.
type Props = {
  projectId: string;
  /** "You run this · In Progress · Active" - what the band used to say. */
  standing: string;
  /** The address, or the parent's name, or nothing. */
  where: string | null;
  visitHref: string | null;
  visitsToday: number;
  addTaskHref: string | null;
  payHref: string | null;
  awardHref: string | null;
};

const g = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const Pin = () => <svg {...g}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
const Tick = () => <svg {...g}><path d="M4 12.5l5 5L20 6.5" /></svg>;
const Box = () => <svg {...g}><path d="M3 8l9-4 9 4v9l-9 4-9-4z" /><path d="M3 8l9 4 9-4M12 12v9" /></svg>;
const Pen = () => <svg {...g}><path d="M4 20h4l10-10-4-4L4 16z" /><path d="M13 7l4 4" /></svg>;
const Phone = () => <svg {...g}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" /></svg>;
const Plus = () => <svg {...g}><path d="M12 5v14M5 12h14" /></svg>;
const Dollar = () => <svg {...g}><path d="M12 3v18M16.5 7.5a3.5 3.5 0 0 0-3.5-2h-2a3 3 0 0 0 0 6h2a3 3 0 0 1 0 6h-2a3.5 3.5 0 0 1-3.5-2" /></svg>;
const Award = () => <svg {...g}><path d="M12 3v5M7.5 8L3 15h9zM16.5 8L12 15h9zM3 15a4.5 4.5 0 0 0 9 0M12 15a4.5 4.5 0 0 0 9 0M8 21h8M12 8v13" /></svg>;

export function QuickActions({ projectId, standing, where, visitHref, visitsToday, addTaskHref, payHref, awardHref }: Props) {
  const nb = (detail: Parameters<typeof openNotebook>[0]) => () => openNotebook({ job: projectId, ...detail });
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
        <button type="button" className="qa-btn" onClick={nb({ tab: "todo", order: false })}>
          <Tick /><span>To do</span>
        </button>
        <button type="button" className="qa-btn" onClick={nb({ tab: "todo", order: true })}>
          <Box /><span>Order</span>
        </button>
        <button type="button" className="qa-btn" onClick={nb({ tab: "note" })}>
          <Pen /><span>Note</span>
        </button>
        <button type="button" className="qa-btn" onClick={nb({ tab: "phone" })}>
          <Phone /><span>Phone book</span>
        </button>
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
