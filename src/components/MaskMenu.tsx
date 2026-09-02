"use client";

import { useEffect, useRef, useState } from "react";
import { setView } from "./viewas";
import { VIEW_HOME } from "./viewmap";

const MaskIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6.5C5.6 5.1 8.7 4.4 12 4.4s6.4.7 9 2.1v4.6c0 5.3-4 9.5-9 9.5s-9-4.2-9-9.5z" />
    <path d="M7 10.6c1-.9 2.4-.9 3.4 0" />
    <path d="M13.6 10.6c1-.9 2.4-.9 3.4 0" />
    <path d="M9 15.4c1.8 1.4 4.2 1.4 6 0" />
  </svg>
);

// Admin-only view-as menu. A details element never closes on its own;
// this one closes on selection, outside click, and Escape.
export function MaskMenu({ views, current, email }: { views: string[]; current: string; email?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="rolemenu rolemenu-right" ref={box}>
      <button
        type="button"
        className="iconlink"
        title="View as"
        aria-label="View as"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <MaskIcon />
      </button>
      {open && (
        <div className="rolemenu-list">
          {email && (
            <span className="rolemenu-item current" style={{ borderBottom: "1px solid #e5e7eb", fontSize: 12 }}>
              {email}
            </span>
          )}
          {views.map((v) =>
            v === current ? (
              <span key={v} className="rolemenu-item current">{v} ✓</span>
            ) : VIEW_HOME[v] ? (
              <button
                key={v}
                type="button"
                className="rolemenu-item"
                style={{ width: "100%", textAlign: "left" }}
                onClick={async () => {
                  setOpen(false);
                  await setView(v);
                }}
              >
                {v}
              </button>
            ) : (
              <span key={v} className="rolemenu-item current">{v} · soon</span>
            )
          )}
        </div>
      )}
    </div>
  );
}
