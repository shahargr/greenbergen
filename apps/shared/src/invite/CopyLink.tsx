"use client";

import { useState } from "react";

// Copy a join link, or share it where the phone supports it. Moved here from
// the homeowner People screen so the invitation form is one component in
// every door; the share text no longer presumes the invitee is a contractor.
export function CopyLink({ link, text = "Join Green Bergen" }: { link: string; text?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(link); setDone(true); } catch { /* the field below is selectable */ }
  }
  async function share() {
    if (navigator.share) { try { await navigator.share({ text: `${text}: ${link}` }); } catch { /* dismissed */ } } else void copy();
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
