"use client";

import { useState } from "react";

// The share sheet where the phone has one; copy where it doesn't.
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const full = url.startsWith("http") ? url : (typeof window !== "undefined" ? window.location.origin : "") + url;
  async function share() {
    try {
      if (navigator.share) { await navigator.share({ title: "My Green Bergen project", url: full }); return; }
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the user cancelled the sheet */ }
  }
  return (
    <div className="row" style={{ marginTop: 6 }}>
      <input className="input grow mono" readOnly value={full} onFocus={(e) => e.target.select()} style={{ fontSize: 13 }} />
      <button type="button" className="btn btn-primary" onClick={() => void share()}>{copied ? "Copied" : "Share"}</button>
    </div>
  );
}
