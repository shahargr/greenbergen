"use client";

import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "../ui";

// The bottom sheet every money form opens in. Escape and the backdrop close
// it; nothing inside is submitted by closing.
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheet-back" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <span className="title">{title}</span>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}
