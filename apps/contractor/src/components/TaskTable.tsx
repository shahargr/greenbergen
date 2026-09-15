import Link from "next/link";
import { shortDate } from "@shared/format";
import type { Twig } from "@/lib/board";

// A TASK LIST AS A TABLE, ON A PHONE.
//
// Shahar (2026-09-15): "show in table format. assigned to, name, stage,
// comment, target end date. find a design where this fits on iphone screen."
//
// Five columns across 390 points is not a table, it is a spreadsheet nobody
// can read - and the one thing he ruled out is sideways scrolling ("fits on
// iphone screen"). So the table is turned on its side per row and held
// together by ALIGNMENT, which is what makes a table a table:
//
//   name ...................... due      <- every due date on the same x
//   who · priority ........... stage     <- every stage on the same x
//   the latest word on it, two lines     <- spans, and only when there is one
//
// Same anatomy in every row, hairlines between them, one panel around the
// lot. You read down a column without a column existing.
//
// The comment is status_note - "where this stands", the live word on the task
// (migration 126) - falling back to the description when nobody has said
// anything yet. Those are different things and the newer one wins.
const STAGE_SHORT: Record<string, string> = {
  "Not Started": "Not started",
  "In Progress": "In progress",
  "Completed Pending Approval": "Pending approval",
  "Pending on Others": "On others",
};

export function TaskTable({ rows, back, showProject = false }: {
  /** Rows with their depth on them - nest() for a list, flat() for a slice. */
  rows: Twig[];
  /** Where a task sends you when you are done with it: back to this list. */
  back: string;
  /** On a list that crosses jobs, the row says which one it is on. */
  showProject?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  if (rows.length === 0) return null;
  return (
    <div className="tt">
      {rows.map(({ t, depth }) => {
        const late = !!t.target_date && t.target_date < today;
        // Who holds it. An assistant is a holder too (migration 079), and
        // nobody is a fact worth reading rather than a blank.
        const who = t.assignee
          ? t.assignee_kind === "assistant" ? `${t.assignee} · assistant` : t.assignee
          : "nobody yet";
        const left = [
          who,
          t.priority === "High" ? "High" : null,
          // A parent says what is under it, so a row with steps is never
          // mistaken for a single task (migration 129).
          t.open_children > 0 ? `${t.open_children} step${t.open_children === 1 ? "" : "s"} left` : null,
          showProject ? t.project : null,
        ].filter(Boolean).join(" · ");
        const say = (t.status_note ?? "").trim() || (t.notes ?? "").trim();
        return (
          <Link key={t.id} href={`/task/${t.id}?back=${encodeURIComponent(back)}`}
            className={`tt-row${late ? " late" : ""}${depth > 0 ? " kid" : ""}`}>
            <span className="name">{t.action}</span>
            <span className={`due${late ? " late" : ""}`}>
              {t.target_date ? shortDate(t.target_date) : "—"}
            </span>
            <span className="who">{left}</span>
            <span className="stage">{STAGE_SHORT[t.status] ?? t.status}</span>
            {say && <span className="say">{say}</span>}
          </Link>
        );
      })}
    </div>
  );
}
