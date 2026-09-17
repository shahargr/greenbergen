"use client";

import { useCallback, useRef, useState } from "react";

// THE PHOTOGRAPHS, ONE AT A TIME (Shahar, 2026-09-17: "this page should have
// carousel for photos... similar to what you might find in Zillow").
//
// It is a scroll-snapping strip, not a slideshow: a thumb drags it the way
// every photo app on the phone works, the arrows are for a mouse, and the
// counter tells you how many there are so nobody swipes into nothing. No
// autoplay - a house is looked at, not watched.
//
// The order is the owner's (house_page_photos.sort, cover first), and the
// first image loads eagerly because it is the one thing the page is about.
export type Shot = { path: string; caption: string | null; is_cover?: boolean };

export function Carousel({ shots, base, alt }: { shots: Shot[]; base: string; alt: string }) {
  const strip = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);

  const go = useCallback((delta: number) => {
    const el = strip.current;
    if (!el) return;
    const n = Math.max(0, Math.min(shots.length - 1, at + delta));
    el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
    setAt(n);
  }, [at, shots.length]);

  // The scroll position is the truth - a drag moves it without our help.
  const onScroll = () => {
    const el = strip.current;
    if (!el || el.clientWidth === 0) return;
    const n = Math.round(el.scrollLeft / el.clientWidth);
    if (n !== at) setAt(n);
  };

  if (shots.length === 0) return null;

  return (
    <div className="car">
      <div className="car-strip" ref={strip} onScroll={onScroll}>
        {shots.map((s, i) => (
          <figure className="car-cell" key={s.path}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${base}/${s.path}`} alt={s.caption ?? `${alt} — photograph ${i + 1}`}
              loading={i === 0 ? "eager" : "lazy"} />
            {s.caption && <figcaption>{s.caption}</figcaption>}
          </figure>
        ))}
      </div>

      {shots.length > 1 && (
        <>
          <button type="button" className="car-arm left" aria-label="Previous photograph"
            onClick={() => go(-1)} disabled={at === 0}>‹</button>
          <button type="button" className="car-arm right" aria-label="Next photograph"
            onClick={() => go(1)} disabled={at === shots.length - 1}>›</button>
          <div className="car-count">{at + 1} / {shots.length}</div>
        </>
      )}
    </div>
  );
}
