import Link from "next/link";

// Three destinations, the same shape as the homeowner app's tab bar:
// the work on offer, the jobs that are already theirs, and one inbox.
export function WorkTabs({ current, offers = 0 }: { current: "work" | "jobs" | "inbox"; offers?: number }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link href="/work" aria-current={current === "work" ? "page" : undefined}>
        Work{offers > 0 && <span className="n">{offers}</span>}
      </Link>
      <Link href="/jobs" aria-current={current === "jobs" ? "page" : undefined}>My jobs</Link>
      <Link href="/inbox" aria-current={current === "inbox" ? "page" : undefined}>Inbox</Link>
    </nav>
  );
}
