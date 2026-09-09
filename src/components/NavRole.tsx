"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { seatLabel } from "@/lib/seatLabel";

// The line under the logo: your highest seat ON THE PROJECT BEING VIEWED,
// said the short way - MY HOME, PROJECT M., CONTRACTOR, VISITOR, ADMIN. The
// same person can be asset owner on one project and a contractor on another,
// so the word follows the route. Off a project page it is the seat the
// server already worked out from everywhere you hold one.
//
// The detail - name, email, "(4 roles)" - lives in the tooltip TopNav sets on
// the whole lockup; the line itself is one word, as Shahar asked.
export function NavRole({
  appUserId, fallback, ranks, admin,
}: {
  appUserId: string | null;
  fallback: string;
  ranks: Record<string, number>;
  admin: boolean;
}) {
  const pathname = usePathname();
  const projectId = useMemo(() => {
    const m = pathname?.match(/^\/my\/(?:project|house)\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }, [pathname]);
  // Keyed by project so a route change never shows the previous project's
  // seat while the new one loads - and so no setState is needed to reset it.
  const [seat, setSeat] = useState<{ projectId: string; label: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!projectId || !appUserId) return;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("project_members")
        .select("role, project_role")
        .eq("project_id", projectId)
        .eq("app_user_id", appUserId)
        .eq("status", "active");
      if (cancelled) return;
      const seats = [...new Set(((data ?? []) as { role: string; project_role: string | null }[]).map((s) => s.project_role ?? s.role))];
      if (seats.length === 0) return; // no seat here (e.g. god mode): keep the fallback
      setSeat({ projectId, label: seatLabel(seats, ranks, admin) });
    })();
    return () => { cancelled = true; };
  }, [projectId, appUserId, ranks, admin]);

  return <>{seat && seat.projectId === projectId ? seat.label : fallback}</>;
}
