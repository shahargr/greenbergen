import Link from "next/link";
import type { ReactNode } from "react";
import { DOORS, DOOR_ORDER, JOIN, NOT_SELF_SERVE, type DoorKey } from "./doors";

// The wording of last resort, if config.public_tagline is unset and the
// database is unreachable. Editable in Admin; see migration 013.
export const DEFAULT_TAGLINE = "A real community, not just a marketplace.";

// The reusable pieces named in the design's component list. Plain CSS
// classes from warm-ink.css; no client state here.

// Card - the white surface everything sits on, with an optional tag slot.
export function Card({ children, className = "", pad = true, soft = false, tag }: { children: ReactNode; className?: string; pad?: boolean; soft?: boolean; tag?: ReactNode }) {
  return (
    <div className={`card ${pad ? "pad" : ""} ${soft ? "soft" : ""} ${className}`}>
      {tag && <span className="tag" style={{ position: "absolute", top: 12, left: 12, zIndex: 1 }}>{tag}</span>}
      {children}
    </div>
  );
}

export function Screen({ children, dark = false }: { children: ReactNode; dark?: boolean }) {
  return <main className={`screen ${dark ? "dark" : ""}`}>{children}</main>;
}

export const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
);
export const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const CheckIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7" /></svg>
);
export const ChevronIcon = () => (
  <svg className="chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
);
export const InfoIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
);
export const WarnIcon = () => (
  <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 2.5 20h19L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
);

// Wordmark - the logo: a little house in the brand green, then "green" in
// the same green and "bergen" in ink, one lowercase word. Swap for the SVG
// file when it lands; keep the same classes so nothing else moves.
//
// It is always a LOCKUP: the app's name set under the wordmark, aligned to
// it, the way a product family names its members. The word says what this
// PRODUCT is, not what the person is - the same person holds three of them.
//
// The door comes from the build (NEXT_PUBLIC_APP_DOOR in each app's
// next.config.ts), so every screen in the contractor app says CONTRACTOR
// whether or not the call site thought to say so. It used to be optional and
// signed-out screens showed the tagline there instead - which left the
// contractor landing page saying nothing about being the contractor app.
//
// THE HOUSE SPANS THE WORD (Shahar): roof at the top of the "b", floor at
// the bottom of the "g" - ascender to descender. So it is sized and
// placed in em relative to the word - 0.78em tall, its base 0.22em below the
// baseline - and moves with the font, never with the door line, which is set
// under the word and indented past the house. No per-door glyph: the house IS
// the Green Bergen mark, and a second icon competes with it.
const APP_DOOR = ((): DoorKey | undefined => {
  const d = process.env.NEXT_PUBLIC_APP_DOOR;
  return d && d in DOORS ? (d as DoorKey) : undefined;
})();

// Manrope: ascender ~0.76em above the baseline, descender ~0.22em below.
// Roof at the top of the "b", floor at the bottom of the "g" (Shahar).
const HOUSE_EM = 0.98;
const DESCENT_EM = 0.22;
const GAP_PX = 5;

export function Wordmark({ size = 15, door = APP_DOOR }: { size?: number; door?: DoorKey }) {
  const house = Math.round(size * HOUSE_EM);
  return (
    <span className="mark">
      <span className="wm-row">
        <svg className="wm-house" width={house} height={house} style={{ top: size * DESCENT_EM, marginRight: GAP_PX }}
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" />
        </svg>
        <span className="wordmark" style={{ fontSize: size }} aria-label="Green Bergen">
          <span className="wm-green">green</span><span className="wm-ink">bergen</span>
        </span>
      </span>
      {door && (
        <span className="wm-door" style={{ fontSize: Math.round(size * 0.63), marginLeft: house + GAP_PX + 1 }}>
          {DOORS[door].short}
        </span>
      )}
    </span>
  );
}

// AppBar - brand / back + title / trailing action.
export function AppBar({
  back, title, sub, right, brand = false, door,
}: { back?: string | (() => void); title?: string; sub?: string; right?: ReactNode; brand?: boolean;
     // Overrides the build's door for the logo line. Rarely needed: the app
     // already knows which door it is.
     door?: DoorKey }) {
  return (
    <header className="appbar">
      {typeof back === "string" && (
        <Link href={back} className="btn btn-ghost btn-icon" aria-label="Back"><BackIcon /></Link>
      )}
      {typeof back === "function" && (
        <button type="button" onClick={back} className="btn btn-ghost btn-icon" aria-label="Back"><BackIcon /></button>
      )}
      {brand && !title && (
        <Link href="/" className="brand grow">
          {/* The logo names the app you are in, signed in or not. The pitch
              (config.public_tagline) lives in the landing hero, not here. */}
          <Wordmark door={door} />
        </Link>
      )}
      {title && (
        <div className="title">{title}{sub && <span className="sub">{sub}</span>}</div>
      )}
      {!brand && !title && <span className="grow" />}
      {right}
    </header>
  );
}

export function DoorIcon({ door, size = 13 }: { door: DoorKey; size?: number }) {
  const p = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (door === "homeowner") {
    return <svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" /></svg>;
  }
  if (door === "expert") {
    // A wrench: the trade's own tool. One glyph, because it is one door now -
    // the person who runs the job and the person who does it are the same
    // member with different trades.
    return <svg {...p}><path d="M15.5 3.5a5.5 5.5 0 0 0-6.9 6.9L3.4 15.6a2 2 0 0 0 0 2.8l2.2 2.2a2 2 0 0 0 2.8 0l5.2-5.2a5.5 5.5 0 0 0 6.9-6.9l-3 3-2.9-.7-.7-2.9z" /></svg>;
  }
  // The portal: everything, in rows.
  return <svg {...p}><path d="M4 5h16M4 12h16M4 19h16" /></svg>;
}

// The switcher, in two halves: the doors you hold, and the doors you could.
//
// It used to show only what you held, which left a homeowner who wanted to
// register a trade with nowhere to go - the contractor door was hidden
// precisely because they did not have it yet. A switcher that only lists
// rooms you are already in cannot be the way you enter a new one.
//
// Never the door you are standing in: a list that offers you this room reads
// as broken. Separate deployments on separate origins, so every one is a
// plain link out rather than a tab.
export function DoorSwitch({ held, current }: { held: DoorKey[]; current: DoorKey }) {
  const yours = DOOR_ORDER.filter((k) => k !== current && held.includes(k));
  // Only what someone can actually start. The builder seat arrives; admin is
  // not self-serve. Offering either would be a dead end.
  const add = DOOR_ORDER.filter((k) => k !== current && !held.includes(k) && JOIN[k]);
  const waiting = DOOR_ORDER.filter((k) => k !== current && !held.includes(k) && NOT_SELF_SERVE[k]);
  if (yours.length === 0 && add.length === 0 && waiting.length === 0) return null;

  return (
    <>
      {yours.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Also yours</div>
          {yours.map((k) => (
            <a key={k} href={DOORS[k].url} className="home-row">
              <span className="ic"><DoorIcon door={k} size={20} /></span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">{DOORS[k].full}</span>
                <span className="m" style={{ display: "block" }}>{DOORS[k].blurb}</span>
              </span>
              <ChevronIcon />
            </a>
          ))}
        </section>
      )}

      {add.length > 0 && (
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Add to your account</div>
          {add.map((k) => (
            <a key={k} href={`${DOORS[k].url}${JOIN[k]!.path}`} className="home-row">
              <span className="ic"><DoorIcon door={k} size={20} /></span>
              <span className="grow" style={{ minWidth: 0 }}>
                <span className="t">{JOIN[k]!.cta}</span>
                <span className="m" style={{ display: "block" }}>{JOIN[k]!.how}</span>
              </span>
              <ChevronIcon />
            </a>
          ))}
        </section>
      )}

      {waiting.map((k) => (
        <p className="tiny text-muted" style={{ margin: 0 }} key={k}>{NOT_SELF_SERVE[k]}</p>
      ))}

      <p className="tiny text-muted" style={{ margin: 0 }}>
        Same sign-in, same account — these are different views of it, not different logins.
        Adding one never asks you to sign up again.
      </p>
    </>
  );
}

// The two icons that sit at the top right of every signed-in screen: the
// inbox (with its count) and the gear. Small, quiet, and always in the same
// place, so the shell never has to explain where the settings went.
// The shell's destinations, top right: inbox, home, setup. This replaced the
// bottom tab bar in the homeowner app (Shahar) - three icons in the header
// cost no height and are where the thumb already goes for the gear.
export function ShellIcons({ unread = 0, gearHref = "/settings", inboxHref = "/inbox", homeHref }: { unread?: number; gearHref?: string; inboxHref?: string; homeHref?: string }) {
  return (
    <span className="shell-icons">
      <Link href={inboxHref} className="btn btn-ghost btn-icon" aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}>
        <InboxIcon />
        {unread > 0 && <span className="dot-n">{unread > 9 ? "9+" : unread}</span>}
      </Link>
      {homeHref && (
        <Link href={homeHref} className="btn btn-ghost btn-icon" aria-label="Home">
          <HouseIcon />
        </Link>
      )}
      {/* Switch seat. One login opens every door you hold, so there is nothing
          to sign out of - this goes to the picker on the portal, which sends
          a one-door person straight back where they were. Signing out is an
          account act and stays behind the gear. */}
      <a href={`${DOORS.portal.url}/choose`} className="btn btn-ghost btn-icon" aria-label="Switch seat" title="Switch seat">
        <DoorsIcon />
      </a>
      <Link href={gearHref} className="btn btn-ghost btn-icon" aria-label="Your account">
        <GearIcon />
      </Link>
    </span>
  );
}

// Four panes: the same mark the portal's top bar uses for the door picker.
export const DoorsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);

export const InboxIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 13h5l1.5 3h5L16 13h5" /><path d="M4.5 5.5h15L21 13v5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18v-5z" />
  </svg>
);

// A real cog. The previous mark was a circle with eight radial spokes,
// which at 20px reads as a sun or an asterisk, not as settings - the teeth
// have to sit ON the rim for the shape to say "configuration".
export const GearIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.4 3.3a1.3 1.3 0 0 1 1.29-1.1h.62a1.3 1.3 0 0 1 1.29 1.1l.16 1.06c.44.15.86.34 1.24.58l.87-.63a1.3 1.3 0 0 1 1.68.13l.44.44a1.3 1.3 0 0 1 .13 1.68l-.63.87c.24.38.43.8.58 1.24l1.06.16a1.3 1.3 0 0 1 1.1 1.29v.62a1.3 1.3 0 0 1-1.1 1.29l-1.06.16c-.15.44-.34.86-.58 1.24l.63.87a1.3 1.3 0 0 1-.13 1.68l-.44.44a1.3 1.3 0 0 1-1.68.13l-.87-.63c-.38.24-.8.43-1.24.58l-.16 1.06a1.3 1.3 0 0 1-1.29 1.1h-.62a1.3 1.3 0 0 1-1.29-1.1l-.16-1.06a6.6 6.6 0 0 1-1.24-.58l-.87.63a1.3 1.3 0 0 1-1.68-.13l-.44-.44a1.3 1.3 0 0 1-.13-1.68l.63-.87a6.6 6.6 0 0 1-.58-1.24l-1.06-.16a1.3 1.3 0 0 1-1.1-1.29v-.62a1.3 1.3 0 0 1 1.1-1.29l1.06-.16c.15-.44.34-.86.58-1.24l-.63-.87a1.3 1.3 0 0 1 .13-1.68l.44-.44a1.3 1.3 0 0 1 1.68-.13l.87.63c.38-.24.8-.43 1.24-.58z" />
    <circle cx="12" cy="12" r="2.9" />
  </svg>
);

export function StepKicker({ children }: { children: ReactNode }) {
  return <div className="step-kicker">{children}</div>;
}

// InlineNotice - framed message; info, error, offline.
export function Notice({ kind = "info", title, children }: { kind?: "info" | "error"; title?: string; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : undefined}>
      {kind === "error" ? <WarnIcon /> : <InfoIcon />}
      <div>{title && <strong>{title}</strong>}{children}</div>
    </div>
  );
}

// NumberedNotes - 01/02/03 explainer rows.
export function NumberedNotes({ items }: { items: ReactNode[] }) {
  return (
    <ol className="notes">
      {items.map((it, i) => (
        <li key={i}><span className="n">{String(i + 1).padStart(2, "0")}</span><span>{it}</span></li>
      ))}
    </ol>
  );
}

// StatusHero - 64 px mark + kicker + headline.
export function StatusHero({ variant = "solid", kicker, title, children, icon }: { variant?: "solid" | "outline" | "neutral"; kicker?: string; title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="status-hero">
      <div className={`mark ${variant}`}>{icon ?? <CheckIcon size={30} />}</div>
      <div>
        {kicker && <div className="kicker">{kicker}</div>}
        <h1 style={{ marginTop: 4 }}>{title}</h1>
        {children && <p className="lead text-muted" style={{ margin: 0 }}>{children}</p>}
      </div>
    </div>
  );
}

export function Avatar({ name, ghost = false }: { name: string | null | undefined; ghost?: boolean }) {
  const ini = (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "GB";
  return <span className={`avatar ${ghost ? "ghost" : ""}`}>{ini}</span>;
}

export function Skeleton({ h = 14, w = "100%", style }: { h?: number; w?: string | number; style?: React.CSSProperties }) {
  return <div className="skel" style={{ height: h, width: w, ...style }} aria-hidden />;
}

export const HouseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>
);
