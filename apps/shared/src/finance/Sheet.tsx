"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { CloseIcon } from "../ui";

// The bottom sheet every money form opens in. Escape and the backdrop close
// it; nothing inside is submitted by closing. It takes focus when it opens
// (the first field when it has one, else the sheet itself), so a keyboard or
// a screen reader is inside the dialog rather than behind it.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  useEffect(() => {
    const first = ref.current?.querySelector<HTMLElement>(".body input, .body select, .body textarea, .body button");
    (first ?? ref.current)?.focus();
  }, []);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="title">{title}</span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}
