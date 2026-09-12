"use client";

import { useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { DOOR_ENTRY, DOOR_LABEL, DOOR_ORDER, type DoorKey } from "@/lib/doors";

// THE DOOR MASK, the portal's own.
//
// Shahar (2026-09-12), on the "Where to?" screen: "i think this is an
// un-necessary step... able to switch between using that mask from the
// previous version in the top nav bar. admin access only via the top nav bar
// and only if you have it enabled. so this screen can be deleted completely."
//
// The picker is gone; this is what replaced it here. The apps share one in
// apps/shared, but the portal does not compile apps/ (see CLAUDE.md) and has
// its own chrome, so it has its own - the same behaviour in the portal's own
// clothes.
//
// A <details>, so it opens with no JavaScript, and it asks my_doors() the
// first time it is opened rather than on every page load: the switcher is the
// rarest thing in the header and must not cost a round trip on every screen.
type Row = { signed_in?: boolean; admin?: boolean; homeowner?: boolean; expert?: boolean };

export function DoorMask({ current = "admin" }: { current?: DoorKey }) {
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
    <details className="door-mask" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void load(); }}>
      <summary className="iconlink" title="Switch door" aria-label="Switch door">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
          <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
        </svg>
      </summary>
      <div className="door-mask-panel">
        <div className="door-mask-head">Switch to</div>
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
        {held !== null && others.length > 0 && (
          <div className="door-mask-note">Where you land when you sign in is set in your settings.</div>
        )}
      </div>
    </details>
  );
}
