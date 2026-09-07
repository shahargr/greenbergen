import { dollars } from "@/lib/format";

// PriceBlock - kicker, big number, config line, the one pending label.
export function PriceBlock({
  cents, was, config, kicker = "Community price · most common setup", delta, pulse = false,
}: { cents: number | null; was?: number | null; config?: string | null; kicker?: string; delta?: string[]; pulse?: boolean }) {
  return (
    <div className="price">
      <div className="kicker">{kicker}</div>
      <div className={`big mono ${pulse ? "pulse" : ""}`} key={cents ?? 0}>
        {cents == null ? "—" : dollars(cents)}
        {was != null && was !== cents ? <span className="was">{dollars(was)}</span> : <small>all of the above</small>}
      </div>
      {delta && delta.length > 0 && <div className="delta">{delta.join(" · ")}</div>}
      {config && <div className="small">{config}</div>}
      <div className="pending">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
        Estimate pending contractor confirmation
      </div>
    </div>
  );
}
