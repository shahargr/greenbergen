"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "./supabase/client";
import { DOORS, DOOR_ORDER, JOIN, readDoors, type DoorKey, type Doors } from "./doors";

// The icons are drawn here rather than imported from ui.tsx: ui.tsx renders
// this component, and a module that imports the module importing it is a
// cycle waiting to bite at build time. Three small paths are cheaper than
// that risk.
const DoorsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);
const Chevron = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
);
const Door = ({ door }: { door: DoorKey }) => {
  const p = { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (door === "homeowner") return <svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-5h4v5" /></svg>;
  if (door === "expert") return <svg {...p}><path d="M15.5 3.5a5.5 5.5 0 0 0-6.9 6.9L3.4 15.6a2 2 0 0 0 0 2.8l2.2 2.2a2 2 0 0 0 2.8 0l5.2-5.2a5.5 5.5 0 0 0 6.9-6.9l-3 3-2.9-.7-.7-2.9z" /></svg>;
  return <svg {...p}><path d="M4 5h16M4 12h16M4 19h16" /></svg>;
};


// THE MASK IN THE TOP BAR.
//
// Shahar (2026-09-12), on the "Where to?" screen: "i think this is an
// un-necessary step... able to switch between using that mask from the
// previous version in the top nav bar. admin access only via the top nav bar
// and only if you have it enabled. so this screen can be deleted completely."
//
// So the picker is gone and this is what replaced it: the doors you hold,
// under the four-pane mark, one tap from anywhere. Admin appears here ONLY
// for somebody who has it - which is the whole of "admin access only via the
// top nav bar and only if you have it enabled".
//
// It is a <details>, so it opens with no JavaScript at all, and it reads
// my_doors() the first time it is opened rather than on every page load: the
// switcher is the rarest thing in the header and must not cost a round trip
// on screens nobody switches from.
export function DoorMask({ current }: { current?: DoorKey }) {
  const [doors, setDoors] = useState<Doors | null>(null);
  const [asked, setAsked] = useState(false);

  const load = useCallback(async () => {
    if (asked) return;
    setAsked(true);
    const { data } = await createClient().rpc("my_doors");
    setDoors(readDoors(data ?? null));
  }, [asked]);

  // Where we are, when the screen did not say: the apps live on one host at
  // /home and /pro, and everything else is the portal.
  const [here, setHere] = useState<DoorKey | undefined>(current);
  useEffect(() => {
    if (current) return;
    const p = window.location.pathname;
    setHere(p.startsWith("/home") ? "homeowner" : p.startsWith("/pro") ? "expert" : "portal");
  }, [current]);

  const held = doors?.held ?? [];
  const others = DOOR_ORDER.filter((k) => k !== here && held.includes(k));
  const add = DOOR_ORDER.filter((k) => k !== here && !held.includes(k) && JOIN[k]);

  return (
    <details className="door-mask" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) void load(); }}>
      <summary className="btn btn-ghost btn-icon" aria-label="Switch door" title="Switch door">
        <DoorsIcon />
      </summary>
      <div className="door-mask-panel">
        <div className="divider-label" style={{ padding: "2px 12px 6px" }}>Switch to</div>

        {!doors && <p className="tiny text-muted" style={{ margin: 0, padding: "0 12px 10px" }}>Reading your doors…</p>}

        {doors && others.length === 0 && add.length === 0 && (
          <p className="tiny text-muted" style={{ margin: 0, padding: "0 12px 10px" }}>
            This is the only door on your account.
          </p>
        )}

        {others.map((k) => (
          <a key={k} href={DOORS[k].entry} className="door-mask-row">
            <span className="ic"><Door door={k} /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{DOORS[k].label}</span>
              <span className="m">{DOORS[k].full}</span>
            </span>
            <Chevron />
          </a>
        ))}

        {add.map((k) => (
          <a key={k} href={`${DOORS[k].url}${JOIN[k]!.path}`} className="door-mask-row">
            <span className="ic"><Door door={k} /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{JOIN[k]!.cta}</span>
              <span className="m">Same account, same sign-in</span>
            </span>
            <Chevron />
          </a>
        ))}

        {doors && held.length > 1 && (
          <p className="tiny text-muted" style={{ margin: 0, padding: "6px 12px 10px" }}>
            Where you land when you sign in is set in your settings.
          </p>
        )}
      </div>
    </details>
  );
}
