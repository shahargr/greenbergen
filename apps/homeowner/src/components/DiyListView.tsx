import { DIY_PHASES, venmoPayLink, type DiyList, type DiyPhase } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { Card } from "@shared/ui";

// THE DIY LIST, READ-ONLY (migration 241): the four phases in order, each
// step with its detail, a tag where we recommend a licensed pro, and a tag
// where nothing after it should start until it is done. The tickable version
// on a job is DiyChecklist, built from the same rows.
export function DiyListView({ list }: { list: DiyList }) {
  return (
    <>
      {DIY_PHASES.map((ph) => {
        const steps = list.steps.filter((s) => s.phase === ph.key);
        if (steps.length === 0) return null;
        return (
          <Card pad key={ph.key}>
            <div className="kicker">{ph.label}</div>
            <ol className="diy-steps">
              {steps.map((s) => (
                <li key={s.id}>
                  <span className="t">{s.step}<DiyTags needsPro={s.needs_pro} isGate={s.is_gate} /></span>
                  {s.detail && <span className="d">{s.detail}</span>}
                </li>
              ))}
            </ol>
          </Card>
        );
      })}
    </>
  );
}

export function DiyTags({ needsPro, isGate }: { needsPro: boolean; isGate: boolean }) {
  return (
    <>
      {needsPro && <span className="tag tag-accent diy-tag">Licensed pro recommended</span>}
      {isGate && <span className="tag tag-outline diy-tag">Before you go on</span>}
    </>
  );
}

// The suggested price. Voluntary: the list is already open; this is the way
// to say thanks, and nothing is recorded either way.
export function DiyPayCard({ list, name }: { list: Pick<DiyList, "suggested_cents" | "venmo">; name: string }) {
  if (!list.venmo || !list.suggested_cents) return null;
  return (
    <Card soft pad>
      <div className="kicker">Suggested price · {dollars(list.suggested_cents)}</div>
      <p className="small" style={{ margin: "4px 0 10px" }}>
        The list is yours either way. If it saves you a call-out, pay what it was worth — {dollars(list.suggested_cents)} is the suggestion.
      </p>
      <a className="btn btn-primary btn-block" href={venmoPayLink(list.venmo, list.suggested_cents, `Green Bergen DIY list: ${name}`)} target="_blank" rel="noopener noreferrer">
        Pay {dollars(list.suggested_cents)} with Venmo
      </a>
      <p className="tiny text-muted center" style={{ margin: "6px 0 0" }}>Opens Venmo to @{list.venmo}.</p>
    </Card>
  );
}

export const phaseLabel = (p: DiyPhase | null | undefined) => DIY_PHASES.find((x) => x.key === p)?.label ?? null;
