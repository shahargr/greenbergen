import Link from "next/link";
import type { ReactNode } from "react";

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
export function Wordmark({ size = 15 }: { size?: number }) {
  return (
    <span className="mark">
      <svg width={size + 3} height={size + 3} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" /></svg>
      <span className="wordmark" style={{ fontSize: size }} aria-label="Green Bergen">
        <span className="wm-green">green</span><span className="wm-ink">bergen</span>
      </span>
    </span>
  );
}

// AppBar - brand / back + title / trailing action.
export function AppBar({
  back, title, sub, right, brand = false,
}: { back?: string | (() => void); title?: string; sub?: string; right?: ReactNode; brand?: boolean }) {
  return (
    <header className="appbar">
      {typeof back === "string" && (
        <Link href={back} className="btn btn-ghost btn-icon" aria-label="Back"><BackIcon /></Link>
      )}
      {typeof back === "function" && (
        <button type="button" onClick={back} className="btn btn-ghost btn-icon" aria-label="Back"><BackIcon /></button>
      )}
      {brand && !title && (
        <Link href="/" className="brand grow"><Wordmark /><span className="sub">Bergen County community, not a marketplace.</span></Link>
      )}
      {title && (
        <div className="title">{title}{sub && <span className="sub">{sub}</span>}</div>
      )}
      {!brand && !title && <span className="grow" />}
      {right}
    </header>
  );
}

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
