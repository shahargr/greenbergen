"use client";

import { useState } from "react";

// The one client piece on the People screen: copy a join link, share it
// where the phone supports it.
export function CopyLink({ link }: { link: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setDone(true); } catch { /* the field below is selectable */ }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ text: `Join Green Bergen as a contractor: ${link}` }); } catch { /* dismissed */ } } else void copy();
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <input className="input mono small" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={() => void copy()}>{done ? "Copied" : "Copy link"}</button>
        <button type="button" className="btn btn-secondary" onClick={() => void share()}>Share…</button>
      </div>
    </div>
  );
}
