"use client";

import { useState } from "react";

export type TimelineItem = { name: string; date: string; label: string; url: string };

// A DATED BUILD TIMELINE, not a gallery (action a8d869ca): "thin photography
// becomes proof of transparency when it is sequenced by date." Oldest first
// - foundation, framing, today - each photograph under its date and, when
// the file was named for it, what it shows. Tap a photograph to see it
// large; Esc or the backdrop to close.
export function Timeline({ items }: { items: TimelineItem[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };
  return (
    <>
      <ol className="timeline">
        {items.map((it, i) => (
          <li key={it.name}>
            <div className="tl-when">
              <span className="tl-date">{fmt(it.date)}</span>
              {it.label && <span className="tl-label">{it.label}</span>}
              {i === items.length - 1 && <span className="tl-now">latest</span>}
            </div>
            <button type="button" className="tl-shot" onClick={() => setOpen(i)} aria-label={`Open the ${fmt(it.date)} photograph`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.label || `Progress, ${fmt(it.date)}`} loading="lazy" />
            </button>
          </li>
        ))}
      </ol>

      {open !== null && (
        <div className="lightbox" onClick={() => setOpen(null)} role="dialog" aria-modal="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={items[open].url} alt={items[open].label || "Photo"} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="lightbox-close" aria-label="Close" onClick={() => setOpen(null)}>×</button>
          <span className="lightbox-caption">{fmt(items[open].date)}{items[open].label ? ` · ${items[open].label}` : ""}</span>
        </div>
      )}
    </>
  );
}
