import Link from "next/link";

// The signed-in shell's two destinations: the catalogue, and the member's
// home(s) with everything live, planned and done on them.
export function HomeTabs({ current, unread = 0 }: { current: "packages" | "project"; unread?: number }) {
  return (
    <nav className="tabs" aria-label="Sections">
      <Link href="/packages" aria-current={current === "packages" ? "page" : undefined}>Packages</Link>
      <Link href="/project" aria-current={current === "project" ? "page" : undefined}>
        My home{unread > 0 && <span className="n">{unread}</span>}
      </Link>
    </nav>
  );
}
