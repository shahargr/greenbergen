import Link from "next/link";

// Four destinations for someone running jobs: the board, everything open
// across it, the money, and one inbox.
export function BuildTabs({ current, tasks = 0 }: { current: "board" | "tasks" | "money" | "inbox"; tasks?: number }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link href="/" aria-current={current === "board" ? "page" : undefined}>Board</Link>
      <Link href="/tasks" aria-current={current === "tasks" ? "page" : undefined}>
        Tasks{tasks > 0 && <span className="n">{tasks}</span>}
      </Link>
      <Link href="/money" aria-current={current === "money" ? "page" : undefined}>Money</Link>
      <Link href="/inbox" aria-current={current === "inbox" ? "page" : undefined}>Inbox</Link>
    </nav>
  );
}
