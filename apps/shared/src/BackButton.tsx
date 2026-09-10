"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// BACK GOES WHERE YOU CAME FROM.
//
// A package page can be reached from the landing rail, from the grid, from
// a project, or from a link a neighbour sent. Its back arrow used to point
// at the grid whatever the route in (Shahar, from the landing: "I expected
// that when one clicks back he will land on the page with the carousel").
// The browser already remembers the way in; the one thing it cannot tell
// us is whether that way in is ours. So the shell notes how long the tab's
// history was when this site was entered (NavOrigin, mounted once per
// document in every app's layout), and the arrow goes back through history
// while there is a page of ours behind it, and to the fallback - the grid -
// when there is not: a shared link opened in a new tab, or the site typed
// in after somewhere else.
const KEY = "gb_nav_h0";

export function NavOrigin() {
  useEffect(() => {
    try {
      let inside = false;
      try { inside = !!document.referrer && new URL(document.referrer).origin === location.origin; } catch { /* odd referrer */ }
      // A fresh entry from outside (or no note yet): the entry page is the
      // floor. A hard load from one of our own pages - a sign-in redirect,
      // a form post - keeps the floor where it was.
      if (!inside || !sessionStorage.getItem(KEY)) sessionStorage.setItem(KEY, String(window.history.length));
    } catch { /* storage blocked: the arrow falls back to the href */ }
  }, []);
  return null;
}

export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  const go = () => {
    let floor = NaN;
    try { floor = Number(sessionStorage.getItem(KEY)); } catch { /* storage blocked */ }
    if (Number.isFinite(floor) && floor > 0 && window.history.length > floor) router.back();
    else router.push(fallback);
  };
  return (
    <button type="button" onClick={go} className="btn btn-ghost btn-icon" aria-label="Back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
  );
}
