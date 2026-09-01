import Link from "next/link";

// Brand treatment D (chosen 2026-09-01): lowercase two-tone wordmark -
// "green" in brand green, "bergen" in ink - left-aligned, utilities on the
// right. One component so every page renders the brand identically.
export function Wordmark({ small = false, href = "/" }: { small?: boolean; href?: string }) {
  return (
    <Link href={href} className={small ? "wordmark wordmark-sm" : "wordmark"}>
      <span className="wm-green">green</span>bergen
    </Link>
  );
}

export function SiteHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="site-header wrap">
      <Wordmark />
      <span className="edge" style={{ justifyContent: "flex-end" }}>{right}</span>
    </header>
  );
}
