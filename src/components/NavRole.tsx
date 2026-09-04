"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// The line under the logo: first name · highest seat ON THE PROJECT BEING
// VIEWED. The same person can be asset owner on one project and a
// contractor on another, so the label follows the route. Off a project
// page it falls back to the person's highest seat anywhere.
export function NavRole({
  first, appUserId, fallback, ranks, title,
}: {
  first: string;
  appUserId: string | null;
  fallback: string;
  ranks: Record<string, number>;
  title?: string;
}) {
  const pathname = usePathname();
  const projectId = useMemo(() => {
    const m = pathname?.match(/^\/my\/(?:project|house)\/([0-9a-f-]{36})/i);
    return m ? m[1] : null;
  }, [pathname]);
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLabel(null);
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
      const top = [...seats].sort((a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0))[0];
      setLabel(`${top}${seats.length > 1 ? ` (${seats.length} roles)` : ""}`);
    })();
    return () => { cancelled = true; };
  }, [projectId, appUserId, ranks]);

  const text = `${first} · ${label ?? fallback}`;
  return (
    <span className="brand-viewfor" title={title ?? text}
      style={{ textTransform: "none", letterSpacing: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "min(60vw, 420px)" }}>
      {text}
    </span>
  );
}
