"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "./supabase/client";
import { withBase } from "./site";

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
// HOST-ABSOLUTE, so the stored value is usable as an href from anywhere.
// usePathname() strips this app's basePath, and the door switcher links
// ACROSS apps - withBase puts it back so /project/x becomes /home/project/x
// and nothing has to know which app wrote the row.
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
    const path = withBase(pathname);
    if (last.current === path) return;

    // NOT WORTH COMING BACK TO. Sign-in and the hand-off would bounce a
    // person straight back out again, and /after-login returning itself is a
    // loop with no exit.
    if (/^(\/home|\/pro|\/build)?\/(login|join|welcome|auth|after-login)(\/|$)/.test(path)) return;

    last.current = path;
    // A uuid anywhere in the path means the page belongs to a project, which
    // is what lets the read re-check the seat before handing the path back.
    const project = path.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0] ?? null;
    void createClient().rpc("remember_place", { p_door: door, p_path: path, p_project: project });
  }, [pathname, door]);

  return null;
}
