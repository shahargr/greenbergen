"use client";

import { useEffect } from "react";
import { markSeen } from "../actions";

// MARK THE CONVERSATION READ, after the page is on the glass. The timeline is
// a read, and a read that writes from its own render is a page that cannot
// be rendered twice honestly - React may render a server component more than
// once for one navigation (see MarkOpened for the same argument). From here
// it is one fire-and-forget call, once, after the messages are already shown.
//
// Failure is silent on purpose: an unread badge that lingers costs a glance,
// never correctness.
export function MarkSeen({ projectId }: { projectId: string }) {
  useEffect(() => {
    if (!projectId) return;
    markSeen(projectId).catch(() => {});
  }, [projectId]);
  return null;
}
