"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

// REMEMBER THAT I WAS HERE, so the next sign-in opens where I left off rather
// than on a list (migration 194).
//
// WHY A CLIENT EFFECT AND NOT THE SERVER COMPONENT ABOVE IT. The project page
// is a read, and a read that writes is a page that cannot be cached, retried
// or rendered twice without lying. React may render a server component more
// than once for one navigation; a stamp fired from there would be a side
// effect inside a render. From here it is one fire-and-forget call after the
// page is already on the glass, so it never delays the thing the person
// actually came for.
//
// FAILURE IS SILENT ON PURPOSE. Nothing on this screen depends on it, and
// mark_project_opened() already refuses a project the caller holds no seat on
// - a lost stamp costs a resume, never correctness. It is not worth an error
// in front of somebody trying to read their job.
export function MarkOpened({ projectId }: { projectId: string }) {
  useEffect(() => {
    if (!projectId) return;
    void createClient().rpc("mark_project_opened", { p_project: projectId });
  }, [projectId]);

  return null;
}
