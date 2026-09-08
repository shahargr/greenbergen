import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { timed } from "@shared/perf";

// The board in one place. Two reads, sent together: who you are (me) and
// every project you hold a seat on with its counts (portal_my_work).
//
// portal_my_work is the whole board already - seat, rank, open tasks, money
// owed and the buckets the filter chips use are all computed in the
// database. The portal's /contractor screen queries project_members and
// projects directly to build the same list; do not repeat that here.
export type Seat = {
  project_id: string; project_name: string; address: string | null; status: string;
  stage: string | null; domain: string | null;
  parent_project_id: string | null; parent_name: string | null;
  seat: string | null; rank: number; my_open_tasks: number;
  bid_amount: number | null; latest_bid_id: string | null;
  owed: number; owed_count: number; buckets: string[];
};

export type Task = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; last_updated: string | null; notes: string | null;
  project: string | null; project_id: string | null; domain: string | null;
  has_contract: boolean; state: "open" | "closed";
  assignee_id: string | null; assignee: string | null; trade: string | null;
};

export type Me = {
  app_user_id: string | null; contact_id: string | null;
  full_name: string | null; email: string | null; is_superadmin: boolean;
};

// A manager seat is the GC / PM; bid_can_manage() is rank >= 50, and
// portal_my_work hands the rank over so the app does not have to ask again.
export const MANAGES = 50;
export const runs = (s: Seat) => s.rank >= MANAGES;

export type Board = {
  signed_in: boolean;
  me: Me | null;
  seats: Seat[];
  tasks: Task[];
  degraded?: boolean;
};

export async function getBoard(): Promise<Board> {
  const supabase = await createClient();
  const { data: claimsData } = await timed("me.claims", () => supabase.auth.getClaims());
  const claims = claimsData?.claims as { sub?: string; email?: string } | undefined;
  if (!claims?.sub) return { signed_in: false, me: null, seats: [], tasks: [] };

  // None of the three depends on another, so they leave together.
  const [{ data: me, error: meErr }, { data: work }, { data: tasks }] = await Promise.all([
    timed("me", () => rpc<Me>(supabase, "me")),
    timed("work", () => rpc<Seat[]>(supabase, "portal_my_work")),
    timed("tasks", () => rpc<Task[]>(supabase, "portal_tasks", { p_domain: "construction", p_closed_limit: 0 })),
  ]);
  if (meErr) console.error("me:", meErr.message);

  return {
    signed_in: true,
    me: me ?? { app_user_id: claims.sub, contact_id: null, full_name: null, email: claims.email ?? null, is_superadmin: false },
    seats: Array.isArray(work) ? work : [],
    tasks: Array.isArray(tasks) ? tasks : [],
    degraded: !!meErr || !Array.isArray(work),
  };
}

// The buckets are computed in the database (active, lead, decision, payment,
// done); the app only names them.
export const BUCKETS = [
  { key: "active", label: "Active" },
  { key: "decision", label: "Needs a decision" },
  { key: "payment", label: "Money" },
  { key: "lead", label: "Leads" },
  { key: "done", label: "Done" },
] as const;
export type BucketKey = (typeof BUCKETS)[number]["key"] | "all";

export const money = (n: number | null | undefined) =>
  n == null || n === 0 ? null : `$${Math.round(n).toLocaleString()}`;
