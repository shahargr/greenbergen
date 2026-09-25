"use client";

import Link from "next/link";
import { MapLink } from "@shared/MapLink";

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
  /** The address ALONE, when there is one and it is this person's to see -
      what a map application can be handed. */
  address: string | null;
  /** The package's process, and how many of its steps are still to do
      (migration 233). A job taken from a package has an order to it, and
      that order is the first thing you want, not the fifth. */
  stepsHref: string | null;
  stepsLeft: number;
  visitHref: string | null;
  visitsToday: number;
  /** The tidy-up process (migration 173), and how many tasks wait in it. */
  tidyHref: string | null;
  tidyCount: number;
  addTaskHref: string | null;
  payHref: string | null;
  /** The project library (Shahar, 2026-09-24: "Replace Award work panel
      with project library") - deliveries by trade, in order, folder view
      with drag-and-drop. Awarding still lives at /project/[id]/award and
      inside the bid room; it lost the tile, not the page. */
  libraryHref: string | null;
  /** Financials - the project's own budget → bid → contract screen, for
      whoever runs the job. It took the "Take me there" slot (Shahar,
      2026-09-23): the address in the caption above is still a map link, so
      navigation stays one tap without costing a tile. In-app since the same
      day - "any financial portal must sit inside each project". */
  financeHref: string | null;
};

const g = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };

const Pin = () => <svg {...g}><path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
// The tidy-up: a sparkle, the sign every phone uses for "let it sort this".
const Sparkle = () => <svg {...g}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" /></svg>;
// The process: a list with its place marked. Steps, in order, one of them now.
const Steps = () => <svg {...g}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="12" r="1.8" fill="currentColor" stroke="none" /><path d="M4.5 4.5v4M4.5 15.5v4" /></svg>;
const Plus = () => <svg {...g}><path d="M12 5v14M5 12h14" /></svg>;
const Dollar = () => <svg {...g}><path d="M12 3v18M16.5 7.5a3.5 3.5 0 0 0-3.5-2h-2a3 3 0 0 0 0 6h2a3 3 0 0 1 0 6h-2a3.5 3.5 0 0 1-3.5-2" /></svg>;
// The library: a folder, because that is what it is.
const FolderGlyph = () => <svg {...g}><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
// The budget: rising bars, money against a plan.
const Bars = () => <svg {...g}><path d="M4 21V13M10 21V8M16 21V11M22 21H2" /></svg>;

export function QuickActions({ standing, where, address, stepsHref, stepsLeft, visitHref, visitsToday, tidyHref, tidyCount, addTaskHref, payHref, libraryHref, financeHref }: Props) {
  return (
    <section className="qa">
      <div className="qa-head">
        <span className="what">{standing}</span>
        {/* The address is the thing you read on the way there, so it is also
            the thing you tap to be taken there. */}
        {where && (address
          ? <MapLink address={address} className="where nav">{where}</MapLink>
          : <span className="where">{where}</span>)}
      </div>
      <div className="qa-grid">
        {/* STEP BY STEP, FIRST. Shahar (2026-09-22) walking the DIY
            generator: "for all this we need step by step ui." On a job taken
            from a package the order IS the job, so it leads - a seventh tile
            on package jobs only (Shahar, 2026-09-25). */}
        {stepsHref && (
          <Link href={stepsHref} className="qa-btn">
            <Steps /><span>Step by step</span>
            {stepsLeft > 0 && <span className="n">{stepsLeft}</span>}
          </Link>
        )}
        {visitHref && (
          <Link href={visitHref} className="qa-btn">
            <Pin /><span>Site visit</span>
            {visitsToday > 0 && <span className="n">{visitsToday} today</span>}
          </Link>
        )}
        {/* FINANCIALS took this slot (Shahar, 2026-09-23: "replace the Take
            me there navigation panel with Financials"). "Take me there"
            (2026-09-17) was a second tap on the same address the caption
            above already links to a map, so it paid a tile for a duplicate;
            the budget wizard - set the budget, bid it out, file the
            contracts - had no way in from the board at all. */}
        {financeHref && (
          <Link href={financeHref} className="qa-btn">
            <Bars /><span>Financials</span>
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
        {/* THE LIBRARY took the award tile (Shahar, 2026-09-24: "Replace
            Award work panel with project library... hold deliveries by
            trades by order"). Awards happen in the bid room and at
            /project/[id]/award; the daily need is finding the survey, the
            proposal, the signed contract. */}
        {libraryHref && (
          <Link href={libraryHref} className="qa-btn">
            <FolderGlyph /><span>Library</span>
          </Link>
        )}
      </div>
    </section>
  );
}
