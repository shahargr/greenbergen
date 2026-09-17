import { shortDate } from "@shared/format";
import { URGENCY_KEY, type ListRow, type Task, type Urgency } from "@/lib/board";

// THE COLOUR AND THE WEIGHT OF A ROW (Shahar, 2026-09-17: "one panel, with
// different colors based on their importance and urgency").
//
// Urgency is a class on the row - the rail down its left edge and the date
// pill read it - and importance is another: High is bold with a filled pill,
// Low is quiet. Written once so the project screen, a trade's screen and any
// list that nests under a category cannot colour the same task two ways.
export function rowClass(t: Task, depth: number, urgency: Urgency): string {
  return [
    `urg-${urgency}`,
    t.priority === "High" ? "imp-high" : t.priority === "Low" ? "imp-low" : null,
    t.is_gate ? "gated" : null,
    depth > 0 ? "kid" : null,
  ].filter(Boolean).join(" ");
}

// The pill on the right: when it is due, in the colour of how urgent that is.
// A parent that borrowed its family's urgency says which date it borrowed; a
// finished task says when it finished.
export function DuePill({ t, urgency, inherited, soonest }: {
  t: Task; urgency: Urgency; inherited?: boolean; soonest?: string | null;
}) {
  const nowrap = { whiteSpace: "nowrap" as const };
  if (urgency === "done") {
    return <span className="tag tag-neutral" style={nowrap}>{t.completed_on ? shortDate(t.completed_on) : "done"}</span>;
  }
  if (inherited && soonest) {
    return <span className="tag tag-outline" style={nowrap}>by {shortDate(soonest)}</span>;
  }
  if (!t.target_date) {
    return urgency === "waiting" ? <span className="tag tag-outline" style={nowrap}>Waiting</span> : null;
  }
  const cls =
    urgency === "late" ? "tag-status"
    : urgency === "week" ? "tag-soon"
    : urgency === "waiting" ? "tag-outline"
    : "tag-neutral";
  return <span className={`tag ${cls}`} style={nowrap}>{shortDate(t.target_date)}</span>;
}

export const HighPill = ({ t }: { t: Task }) =>
  t.state === "open" && t.priority === "High"
    ? <span className="tag" style={{ whiteSpace: "nowrap" }}>High</span>
    : null;

// What the colours mean, said once above a list. Tiny, because after the
// second visit nobody reads it - but the first visit needs it.
export function UrgencyKey() {
  return (
    <div className="urg-key" aria-label="What the colours mean">
      {URGENCY_KEY.map((k) => (
        <span key={k.key} className={`k urg-${k.key}`}><span className="d" aria-hidden />{k.label}</span>
      ))}
      <span className="k"><b>Bold</b>&nbsp;is high priority</span>
    </div>
  );
}

export type { ListRow };
