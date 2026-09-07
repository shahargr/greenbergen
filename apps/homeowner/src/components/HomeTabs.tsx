import Link from "next/link";

// The signed-in shell's three destinations: the catalogue, the member's
// home(s) with everything planned, live and done, and one inbox across all.
export function HomeTabs({ current, unread = 0 }: { current: "packages" | "project" | "inbox"; unread?: number }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link href="/packages" aria-current={current === "packages" ? "page" : undefined}>Packages</Link>
      <Link href="/project" aria-current={current === "project" ? "page" : undefined}>My home</Link>
      <Link href="/inbox" aria-current={current === "inbox" ? "page" : undefined}>
        Inbox{unread > 0 && <span className="n">{unread}</span>}
      </Link>
    </nav>
  );
}
