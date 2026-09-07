import Link from "next/link";
import type { BookingSummary } from "@/lib/me";

// The banner that waits for the owner. It appears on every screen of the
// shell while a booked job is still short of photos, and disappears the
// moment the last one lands (or the owner closes the request from the
// inbox). It never blocks anything - the job is already out to contractors
// and the price is already locked; this is what lets one of them confirm it
// without driving over.
export function PhotoBanner({ bookings }: { bookings: BookingSummary[] }) {
  const waiting = bookings.filter((b) => b.photos_action_id && b.photos_needed > 0);
  if (waiting.length === 0) return null;
  const one = waiting.length === 1 ? waiting[0]! : null;
  const total = waiting.reduce((n, b) => n + b.photos_needed, 0);

  return (
    <Link href={one ? `/project/${one.project_id}#photos` : "/inbox"} className="banner-ask">
      <span className="ic" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
      </span>
      <span className="grow">
        <strong>{total === 1 ? "One photo still to add" : `${total} photos still to add`}</strong>
        <span style={{ display: "block" }}>
          {one
            ? `Your ${one.tile_title.toLowerCase()} is booked at the price you saw. Add ${one.photos_needed === 1 ? "it" : "them"} and the contractor can confirm without a visit.`
            : `Across ${waiting.length} jobs. Each one is booked; the photos are what let a contractor confirm the price without a visit.`}
        </span>
      </span>
      <span className="go" aria-hidden>→</span>
    </Link>
  );
}
