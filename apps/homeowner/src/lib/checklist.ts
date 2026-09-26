import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { timed } from "@shared/perf";
import type { DiyPhase } from "@shared/catalogue";

// THE DIY CHECKLIST (migrations 195b, 196).
//
// Read apart from homeowner_booking on purpose: that function is the whole
// screen's read and 8.4k of SQL, and only the DIY branch renders this. The
// page fetches both in one Promise.all, so this costs a key in the same
// round rather than a round.
export type ChecklistItem = {
  id: string;
  action: string;
  status: string;
  notes: string | null;
  asks: string | null;
  is_gate: boolean;
  // From the DIY list step the task was made from (migration 241); null on
  // a checklist built from the scope before the lists existed.
  phase: DiyPhase | null;
  needs_pro: boolean;
  done: boolean;
};

export type Checklist = {
  project_id: string;
  delivery: "diy" | "hired" | null;
  parent_action_id: string | null;
  items: ChecklistItem[];
};

export async function getChecklist(projectId: string): Promise<Checklist | null> {
  const supabase = await createClient();
  const { data, error } = await timed("checklist", () =>
    rpc<Checklist>(supabase, "homeowner_checklist", { p_project: projectId }));
  // Never a blocker: the screen renders its own scope list when this is
  // missing, and a job is not less usable because its checklist did not load.
  if (error || !data) return null;
  return data;
}
