"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// WHERE I WAS, PER SEAT (migration 199).
//
// Shahar (2026-09-20): "have a last page visit per seat so i can jump between
// tablet, mobile and desktop experience and navigate automatically to the
// same location, or when i change my seat i can go back where i was before."
//
// WHY IT LIVES IN THE LAYOUT and not on three project screens, which is where
// the first attempt put it: the page worth returning to is usually not the
// project's front page. It is the money tab, the timeline, the one checklist
// somebody was halfway through. A stamp that only fires on /project/[id]
// remembers the project and forgets the errand.
//
// HOST-ABSOLUTE ALREADY. The portal is the root app - no basePath - so what
// usePathname() gives is what the switcher can link to. The two proxied apps
// put their base back with withBase(); here there is nothing to put back.
//
// ONE WRITE PER LANDING, not per render: the ref means a bounced render or a
// re-mount does not re-stamp, and an unchanged path never goes to the server.
// Failure is silent on purpose - nothing on any screen depends on it, and a
// lost stamp costs a resume, never correctness.
export function RememberPlace({ door }: { door: "homeowner" | "expert" | "portal" }) {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const path = pathname;
    if (last.current === path) return;

    // NOT WORTH COMING BACK TO. Sign-in and the hand-off would bounce a
    // person straight back out again, and /after-login returning itself is a
    // loop with no exit.
    if (/^(\/home|\/pro|\/build)?\/(login|join|welcome|auth|after-login)(\/|$)/.test(path)) return;

    last.current = path;
    // A uuid anywhere in the path means the page belongs to a project, which
    // is what lets the read re-check the seat before handing the path back.
    const project = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
    // DISPATCHED, NOT JUST BUILT. A PostgrestFilterBuilder is a THENABLE,
    // not a promise: the request is only sent from inside .then(). `void
    // builder` built one and dropped it, so this wrote nothing at all while
    // every awaited read beside it worked - the logs showed my_last_places
    // 19 times and remember_place zero. Nothing on screen depends on this,
    // which is exactly why it went unnoticed, so the failure stays silent
    // and only releases the guard for the next attempt.
    createClient()
      .rpc("remember_place", { p_door: door, p_path: path, p_project: project })
      .then(
        ({ error }) => { if (error) last.current = null; },
        () => { last.current = null; },
      );
  }, [pathname, door]);

  return null;
}
