import Link from "next/link";

// The signed-in shell's two destinations. Most members have one project,
// so "Project" is the project itself, not a list.
export function HomeTabs({ current, unread = 0 }: { current: "packages" | "project"; unread?: number }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link href="/packages" aria-current={current === "packages" ? "page" : undefined}>Packages</Link>
      <Link href="/project" aria-current={current === "project" ? "page" : undefined}>
        My project{unread > 0 && <span className="n">{unread}</span>}
      </Link>
    </nav>
  );
}
