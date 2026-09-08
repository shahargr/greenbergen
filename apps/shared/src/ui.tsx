import Link from "next/link";
import type { ReactNode } from "react";
import { DOORS, DOOR_ORDER, type DoorKey } from "./doors";

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
// With a door, it becomes a LOCKUP: the app's name set under the wordmark,
// aligned to it, in the way a product family names its members. That is more
// truthful than a badge beside it - the word says what this PRODUCT is, not
// what the person is, and the same person holds three of them. It also costs
// no height, because it takes the line the tagline had.
//
// No per-door glyph here on purpose: the house IS the Green Bergen mark, and
// a second icon next to it competes with it. The glyphs earn their place in
// DoorSwitch, where there is a list to scan.
export function Wordmark({ size = 15, door }: { size?: number; door?: DoorKey }) {
  return (
    <span className="mark">
      <svg width={size + 3} height={size + 3} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" /></svg>
      <span className="wm-stack">
        <span className="wordmark" style={{ fontSize: size }} aria-label="Green Bergen">
          <span className="wm-green">green</span><span className="wm-ink">bergen</span>
        </span>
        {door && <span className="wm-door">{DOORS[door].label}</span>}
      </span>
    </span>
  );
}

// AppBar - brand / back + title / trailing action.
export function AppBar({
  back, title, sub, right, brand = false, door, tagline,
}: { back?: string | (() => void); title?: string; sub?: string; right?: ReactNode; brand?: boolean; door?: DoorKey;
     // Public pages only - signed in, the logo carries the app name instead.
     // Editable in Admin (config.public_tagline); this is the fallback if the
     // database has not answered.
     tagline?: string | null }) {
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
          {/* Signed in, the logo names the app you are in. Signed out it
              sells - a stranger needs the pitch, and someone already inside
              needs to know where they are. One line either way. */}
          <Wordmark door={door} />
          {!door && <span className="sub">{tagline ?? DEFAULT_TAGLINE}</span>}
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
  if (door === "contractor") {
    // A wrench: the trade's own tool.
    return <svg {...p}><path d="M15.5 3.5a5.5 5.5 0 0 0-6.9 6.9L3.4 15.6a2 2 0 0 0 0 2.8l2.2 2.2a2 2 0 0 0 2.8 0l5.2-5.2a5.5 5.5 0 0 0 6.9-6.9l-3 3-2.9-.7-.7-2.9z" /></svg>;
  }
  if (door === "builder") {
    // A plumb line over a base: someone setting the work out, not doing it.
    return <svg {...p}><path d="M12 3v9" /><path d="m8.5 12 3.5 6 3.5-6z" /><path d="M3 21h18" /></svg>;
  }
  // The portal: everything, in rows.
  return <svg {...p}><path d="M4 5h16M4 12h16M4 19h16" /></svg>;
}

// The switcher. Only the doors this person actually holds, and never the one
// they are standing in - a list that offers you the room you are in reads as
// broken. These are separate deployments on separate origins, so each is a
// plain link out, not a tab.
export function DoorSwitch({ held, current }: { held: DoorKey[]; current: DoorKey }) {
  const others = DOOR_ORDER.filter((k) => k !== current && held.includes(k));
  if (others.length === 0) return null;
  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="divider-label">Also yours</div>
      {others.map((k) => (
        <a key={k} href={DOORS[k].url} className="home-row">
          <span className="ic"><DoorIcon door={k} size={20} /></span>
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="t">{DOORS[k].full}</span>
            <span className="m" style={{ display: "block" }}>{DOORS[k].blurb}</span>
          </span>
          <ChevronIcon />
        </a>
      ))}
      <p className="tiny text-muted" style={{ margin: 0 }}>
        Same sign-in, same account — these are different views of it, not different logins.
      </p>
    </section>
  );
}

// The two icons that sit at the top right of every signed-in screen: the
// inbox (with its count) and the gear. Small, quiet, and always in the same
// place, so the shell never has to explain where the settings went.
export function ShellIcons({ unread = 0, gearHref = "/settings", inboxHref = "/inbox" }: { unread?: number; gearHref?: string; inboxHref?: string }) {
  return (
    <span className="shell-icons">
      <Link href={inboxHref} className="btn btn-ghost btn-icon" aria-label={unread > 0 ? `Inbox, ${unread} unread` : "Inbox"}>
        <InboxIcon />
        {unread > 0 && <span className="dot-n">{unread > 9 ? "9+" : unread}</span>}
      </Link>
      <Link href={gearHref} className="btn btn-ghost btn-icon" aria-label="Your account">
        <GearIcon />
      </Link>
    </span>
  );
}

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
