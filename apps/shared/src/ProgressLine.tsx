import type { Progress } from "./progress";
import { shortDay } from "./format";
import { CheckIcon } from "./ui";

// ProgressLine - generated milestones; done, current, upcoming nodes with a
// date when it happened or a typical range when it hasn't.
export function ProgressLine({ progress, compact = false }: { progress: Progress | null; compact?: boolean }) {
  if (!progress) return null;
  return (
    <div className="pline" role="list" aria-label="Progress">
      {progress.nodes.map((n) => (
        <div key={n.key} className={`node ${n.status}`} role="listitem" aria-current={n.status === "current" ? "step" : undefined}>
          <span className="dot">{n.status === "done" && <CheckIcon size={11} />}</span>
          {!compact && <span className="lbl">{n.name}</span>}
          {!compact && <span className="rng">{n.status === "done" ? shortDay(n.at) : n.typical_range ?? ""}</span>}
        </div>
      ))}
    </div>
  );
}

// THE SAME LINE, LYING DOWN. For a row that has to say WHERE a job is, not
// just how many milestones are behind it - "1 of 7" is a score, and a person
// wants a position. Dots and rails only, no labels: it sits inside a folder
// row a thumb wide, and the names are on the screen it opens.
export function ProgressBead({ progress }: { progress: Progress | null }) {
  if (!progress || progress.nodes.length === 0) return null;
  return (
    <span className="pline inline" role="img"
          aria-label={`${progress.done_count} of ${progress.total} milestones done${progress.current ? `, now: ${progress.current.name}` : ""}`}>
      {progress.nodes.map((n) => (
        <span key={n.key} className={`node ${n.status}`}><span className="dot" /></span>
      ))}
    </span>
  );
}
