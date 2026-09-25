import { Card } from "@shared/ui";
import { tickStep } from "./actions";
import type { ChecklistItem } from "@/lib/checklist";
import { phaseLabel } from "@/components/DiyListView";

// THE DIY CHECKLIST, TICKABLE (migrations 195b / 196).
//
// Shahar (2026-09-19): "a DIY task obviously will give you a checklist of
// everything that needs to happen."
//
// Each line is a real row in actions - the same table the builders and the
// trades work from - so closing one here is the same act as closing one
// there, and the job's open count on every other screen moves with it. That
// is the reason these are tasks and not a list rendered from scope: rulebook
// 42, a scope line that generates no task is invisible.
//
// NO JAVASCRIPT. One form per row posting to a server action, so it works on
// a phone in a basement with one bar - which is where a checklist is actually
// read. Closed steps stay on the list, struck through: a checklist that hides
// what you finished takes away the only satisfying part of it.
export function DiyChecklist({ projectId, items, trade }: { projectId: string; items: ChecklistItem[]; trade: string }) {
  const done = items.filter((i) => i.done).length;
  return (
    <Card pad>
      <div className="row" style={{ alignItems: "baseline", gap: 8 }}>
        <div className="kicker" style={{ flex: 1 }}>Doing it yourself</div>
        <span className="tiny text-muted">{done} of {items.length} done</span>
      </div>

      <ul className="stack" style={{ listStyle: "none", padding: 0, margin: "8px 0 0", gap: 2 }}>
        {items.map((it, i) => (
          // A heading where the DIY list's phase changes (migration 241);
          // a checklist built from scope has no phases and draws none.
          <li key={it.id} className={it.phase && it.phase !== items[i - 1]?.phase ? "diy-phase-start" : undefined} data-phase={it.phase && it.phase !== items[i - 1]?.phase ? phaseLabel(it.phase) ?? undefined : undefined} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--color-hairline, #e8e8e4)" }}>
            {it.done ? (
              <span aria-hidden style={{ width: 22, textAlign: "center", lineHeight: "22px" }}>✓</span>
            ) : (
              <form action={tickStep}>
                <input type="hidden" name="project" value={projectId} />
                <input type="hidden" name="action_id" value={it.id} />
                <button
                  type="submit"
                  aria-label={`Mark done: ${it.action}`}
                  style={{ width: 22, height: 22, borderRadius: 6, border: "1.5px solid currentColor", background: "transparent", cursor: "pointer", opacity: 0.5 }}
                />
              </form>
            )}
            <span style={{ flex: 1 }}>
              <span style={it.done ? { textDecoration: "line-through", opacity: 0.55 } : undefined}>
                {it.action}
                {/* A gate is a step you cannot usefully do out of order - it
                    is worth saying so before somebody buries it. */}
                {it.is_gate && !it.done && <span className="tag tag-outline" style={{ marginLeft: 6, padding: "1px 7px" }}>before you go on</span>}
                {it.needs_pro && !it.done && <span className="tag tag-accent" style={{ marginLeft: 6, padding: "1px 7px" }}>licensed pro recommended</span>}
              </span>
              {/* asks is what the step actually needs decided, and it is the
                  most useful thing on the row when you are standing in front
                  of the work. */}
              {!it.done && (it.asks || it.notes) && (
                <span className="tiny text-muted" style={{ display: "block", marginTop: 2 }}>{it.asks ?? it.notes}</span>
              )}
            </span>
          </li>
        ))}
      </ul>

      <p className="tiny text-muted" style={{ margin: "10px 0 0" }}>
        The order most {trade} work in. Tick them as you go — nothing here is sent to anybody, and
        changing your mind to turn-key keeps everything you have done.
      </p>
    </Card>
  );
}
