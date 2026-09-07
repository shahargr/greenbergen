"use client";

import { useEffect, useState } from "react";
import { ago, dayClock } from "@shared/format";
import { Blueprint } from "@shared/ui";

// WaitingCard - pulsing icon, copy, the 24 h progress bar. Client-side so
// the bar keeps moving without a reload.
export function WaitingCard({ postedAt, replyBy, instant }: { postedAt: string; replyBy: string | null; instant: boolean }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);
  const start = new Date(postedAt).getTime();
  const end = replyBy ? new Date(replyBy).getTime() : start + 86400000;
  const pct = Math.max(2, Math.min(100, ((now - start) / (end - start)) * 100));
  return (
    <Blueprint pad>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="breath" style={{ color: "var(--color-accent)", marginTop: 2 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>
        </span>
        <div className="grow">
          <div className="card-title">{instant ? "Finding your contractor" : "A contractor is checking the details"}</div>
          <p className="small text-muted" style={{ margin: "2px 0 0" }}>Posted {ago(postedAt)}. Matching takes at least 24 hours — usually less than 48.</p>
        </div>
      </div>
      <div className="wait-bar" style={{ marginTop: 12 }}><span style={{ width: `${pct}%` }} /></div>
      <div className="marks" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
        <span>Posted {dayClock(postedAt)}</span>
        <span>24 h mark · {dayClock(replyBy ?? new Date(end).toISOString())}</span>
      </div>
    </Blueprint>
  );
}
