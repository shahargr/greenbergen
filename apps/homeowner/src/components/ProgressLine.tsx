import type { Progress } from "@/lib/me";
import { shortDay } from "@/lib/format";
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
