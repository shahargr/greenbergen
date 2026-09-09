import Link from "next/link";

// The portal's logo, as a LOCKUP: the house, then "greenbergen" with a line
// under it saying what this door is to you. The apps do the same thing from
// apps/shared/ui.tsx; this is the portal's copy because the root tsconfig
// does not reach into apps/.
//
// The line defaults to HOMES - the portal is where the houses live - and TopNav overrides it with the seat you actually hold on the
// project you are looking at (VISITOR, PROJECT M., CONTRACTOR, ADMIN).
//
// THE HOUSE SPANS THE WORD: roof at the top of the "b", floor at the bottom
// of the "g" - ascender to descender. Sized in em and dropped below the baseline by
// the descender, so it moves with the font and never with the door line.
const HOUSE_EM = 0.98;
const DESCENT_EM = 0.22;
const GAP_PX = 5;

export function Wordmark({ small = false, href = "/", door = "Homes" }: { small?: boolean; href?: string; door?: React.ReactNode }) {
  const size = small ? 17 : 21;
  const house = Math.round(size * HOUSE_EM);
  return (
    <Link href={href} className={small ? "wordmark wordmark-sm" : "wordmark"} aria-label="Green Bergen">
      <span className="wm-row">
        <svg className="wm-house" width={house} height={house} style={{ top: size * DESCENT_EM, marginRight: GAP_PX }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" />
        </svg>
        <span className="wm-word"><span className="wm-green">green</span>bergen</span>
      </span>
      {door && <span className="wm-door" style={{ marginLeft: house + GAP_PX + 1 }}>{door}</span>}
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
