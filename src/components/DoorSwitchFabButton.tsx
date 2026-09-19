"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DOOR_ENTRY, DOOR_LABEL, DOOR_ORDER, type DoorKey } from "@/lib/doors";

// THE FLOATING DOOR SWITCH, the portal's own half.
//
// Shahar (2026-09-19): "for testing, place this icon as a floating icon so i
// don't need to go back all the way every time i need to change the seat i'm
// logged under."
//
// The apps share one in apps/shared; the portal does not compile apps/ (see
// CLAUDE.md), so it has its own - the same control in the portal's clothes,
// and the same trick the header's DoorMask uses: a <details>, so it opens
// without JavaScript, and my_doors() is asked THE FIRST TIME IT IS OPENED
// rather than on every page load. A switch that floats on every screen must
// not cost a round trip on every screen.
type Row = { signed_in?: boolean; admin?: boolean; homeowner?: boolean; expert?: boolean };

export function DoorSwitchFabButton({ current = "admin" }: { current?: DoorKey }) {
  const [held, setHeld] = useState<DoorKey[] | null>(null);
  const [asked, setAsked] = useState(false);

  const load = useCallback(async () => {
    if (asked) return;
    setAsked(true);
    const { data } = await createClient().rpc("my_doors");
    const row = (data ?? {}) as Row;
    const has: Record<DoorKey, boolean | undefined> = {
      homeowner: row.homeowner, expert: row.expert, admin: row.admin,
    };
    setHeld(DOOR_ORDER.filter((k) => has[k]));
  }, [asked]);

  const others = (held ?? []).filter((k) => k !== current);

  return (
    <details className="door-fab"
      onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void load(); }}>
      <summary title={`You are in ${DOOR_LABEL[current].title} — switch`} aria-label="Switch door">
        {/* Two arrows passing: the glyph that reads as "swap" rather than as
            "settings". The same mark the apps float. */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
        </svg>
      </summary>
      <div className="door-mask-panel door-fab-panel">
        <div className="door-mask-head">You are in {DOOR_LABEL[current].title}</div>
        {held === null && <div className="door-mask-note">Reading your doors…</div>}
        {held !== null && others.length === 0 && (
          <div className="door-mask-note">This is the only door on your account.</div>
        )}
        {others.map((k) => (
          <a key={k} href={DOOR_ENTRY[k]} className="door-mask-row">
            <strong>{DOOR_LABEL[k].title}</strong>
            <span>{DOOR_LABEL[k].blurb}</span>
          </a>
        ))}
      </div>
    </details>
  );
}
