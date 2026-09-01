"use client";

import { useCallback, useEffect, useState } from "react";

export type GalleryItem = { name: string; label: string; url: string };

// Thumbnail grid with a built-in lightbox: click to view large, arrows or
// swipe-tap to move, Esc or backdrop to close. No dependencies.
export function Gallery({ items }: { items: GalleryItem[] }) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const step = useCallback(
    (d: number) => {
      setOpenIdx((i) => (i === null ? null : (i + d + items.length) % items.length));
    },
    [items.length],
  );

  useEffect(() => {
    if (openIdx === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIdx(null);
      if (e.key === "ArrowRight") step(1);
      if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openIdx, step]);

  return (
    <>
      <div className="gallery">
        {items.map((g, i) => (
          <figure key={g.name} style={{ margin: 0 }}>
            <button type="button" className="gallery-thumb" onClick={() => setOpenIdx(i)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={g.url} alt={g.label || `Photo ${i + 1}`} loading="lazy" />
            </button>
            {g.label && <figcaption className="muted small">{g.label}</figcaption>}
          </figure>
        ))}
      </div>

      {openIdx !== null && (
        <div className="lightbox" onClick={() => setOpenIdx(null)} role="dialog" aria-modal="true">
          <button
            type="button" className="lightbox-nav" aria-label="Previous"
            style={{ left: 10 }}
            onClick={(e) => { e.stopPropagation(); step(-1); }}
          >
            ‹
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={items[openIdx].url}
            alt={items[openIdx].label || "Photo"}
            onClick={(e) => e.stopPropagation()}
          />
          <button
            type="button" className="lightbox-nav" aria-label="Next"
            style={{ right: 10 }}
            onClick={(e) => { e.stopPropagation(); step(1); }}
          >
            ›
          </button>
          <button
            type="button" className="lightbox-close" aria-label="Close"
            onClick={() => setOpenIdx(null)}
          >
            ×
          </button>
          {items[openIdx].label && <span className="lightbox-caption">{items[openIdx].label}</span>}
        </div>
      )}
    </>
  );
}
