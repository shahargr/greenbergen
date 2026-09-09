import Link from "next/link";

// The portal's logo, as a LOCKUP: the house, then "greenbergen" with a line
// under it saying what this door is to you. The apps do the same thing from
// apps/shared/ui.tsx; this is the portal's copy because the root tsconfig
// does not reach into apps/.
//
// The line defaults to MY HOME - the portal is the owner's home ("My home ...
// my way") - and TopNav overrides it with the seat you actually hold on the
// project you are looking at (VISITOR, PROJECT M., CONTRACTOR, ADMIN).
//
// The house is as tall as both lines, so it reads as one mark and not as an
// icon next to a word.
export function Wordmark({ small = false, href = "/", door = "My home" }: { small?: boolean; href?: string; door?: React.ReactNode }) {
  const size = small ? 17 : 21;
  const house = Math.round(size + 2 + size * 0.6);
  return (
    <Link href={href} className={small ? "wordmark wordmark-sm" : "wordmark"} aria-label="Green Bergen">
      <svg width={house} height={house} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="wm-house">
        <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" />
      </svg>
      <span className="wm-stack">
        <span className="wm-word"><span className="wm-green">green</span>bergen</span>
        {door && <span className="wm-door">{door}</span>}
      </span>
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
