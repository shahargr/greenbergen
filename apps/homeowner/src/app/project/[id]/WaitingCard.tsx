"use client";

import { useEffect, useState } from "react";
import { ago } from "@shared/format";
import { Card } from "@shared/ui";

// WaitingCard - what a homeowner sees between posting and a contractor
// taking it.
//
// It used to be a 24-hour countdown bar. There is no window any more
// (migration 016): an offer stays open until someone takes it or the
// homeowner pulls it, so a bar filling toward a deadline that no longer
// exists would be a lie. What is honest is how long it has been out, and
// how many trades are looking at it.
//
// offered === 0 is the case worth being straight about: the job posted but
// nobody eligible exists yet. Saying "finding your contractor" then would be
// the worst kind of quiet failure.
export function WaitingCard({
  postedAt, offered, instant,
}: {
  postedAt: string;
  offered: number;
  instant: boolean;
}) {
  const [, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(t); }, []);

  if (offered === 0) {
    return (
      <Card pad>
        <div className="card-title">Nobody to send this to yet</div>
        <p className="small text-muted" style={{ margin: "4px 0 0" }}>
          Your price is held and your job is saved — but there is no approved contractor in this
          trade on Green Bergen yet, so it has not reached anyone. We&apos;re working on it, and
          you&apos;ll hear the moment that changes. Nothing is charged meanwhile.
        </p>
      </Card>
    );
  }

  return (
    <Card pad>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <span className="breath" style={{ color: "var(--color-accent)", marginTop: 2 }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="6" /><path d="m20 20-4.5-4.5" /></svg>
        </span>
        <div className="grow">
          <div className="card-title">{instant ? "Finding your contractor" : "A contractor is checking the details"}</div>
          <p className="small text-muted" style={{ margin: "2px 0 0" }}>
            Posted {ago(postedAt)} to {offered} {offered === 1 ? "contractor" : "contractors"} in this trade.
            The first to take it gets the job, at the price you were quoted — there&apos;s no deadline
            and no auction.
          </p>
        </div>
      </div>
    </Card>
  );
}
