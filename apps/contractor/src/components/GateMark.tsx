// THE GATE SIGN. Shahar (2026-09-16): "such task created should be logged with
// a gate sign."
//
// A barrier, not a warning triangle and not a padlock. A gate is not an error
// and it is not a secret - it is a thing across the road that lifts once
// somebody deals with it, and that is what the drawing should say.
export function GateMark({ label = true }: { label?: boolean }) {
  return (
    <span className="gate-chip" title="Everything else waits on this">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" aria-hidden>
        <path d="M4 5v14M20 5v14M4 9h16M4 14h16" />
      </svg>
      {label && <span>gate</span>}
    </span>
  );
}
