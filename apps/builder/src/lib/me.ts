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

// ---------------------------------------------------------------------------
// The hierarchy.
//
// A development holds homes; a home holds jobs. portal_my_work() ALREADY
// returns parent_project_id on every seat, so the tree costs nothing: asking
// the database a second time - one call per level - would buy nothing but a
// round trip, and a round trip here is ~187 ms warm against a 5 ms query.
// One read, arranged in the app.
export type Node = {
  seat: Seat;
  children: Node[];
  open: number;   // open tasks on this project AND everything beneath it
  mine: number;   // ...of those, the ones assigned to me
  owed: number;   // money owed, rolled up the same way
  count: number;  // projects beneath it
};

const byWorkload = (a: Node, b: Node) =>
  b.open - a.open || b.count - a.count || a.seat.project_name.localeCompare(b.seat.project_name);

export function buildTree(seats: Seat[], tasks: Task[], contactId: string | null): Node[] {
  const byId = new Map(seats.map((s) => [s.project_id, s]));
  const kids = new Map<string, Seat[]>();
  const roots: Seat[] = [];
  for (const s of seats) {
    // A seat is a root when its parent is a project you do not hold. That is
    // what makes the board work for a trade invited onto one job of someone
    // else's build: the job itself is the top of their tree.
    const parent = s.parent_project_id && byId.has(s.parent_project_id) ? s.parent_project_id : null;
    if (parent) kids.set(parent, [...(kids.get(parent) ?? []), s]);
    else roots.push(s);
  }

  const openOwn = new Map<string, number>();
  const mineOwn = new Map<string, number>();
  for (const t of tasks) {
    if (t.state !== "open" || !t.project_id) continue;
    openOwn.set(t.project_id, (openOwn.get(t.project_id) ?? 0) + 1);
    if (contactId && t.assignee_id === contactId) mineOwn.set(t.project_id, (mineOwn.get(t.project_id) ?? 0) + 1);
  }

  // seen guards against a parent chain that loops back on itself - a bad row
  // should make the board wrong, never make it hang.
  const seen = new Set<string>();
  const make = (s: Seat): Node => {
    seen.add(s.project_id);
    const children = (kids.get(s.project_id) ?? []).filter((c) => !seen.has(c.project_id)).map(make);
    children.sort(byWorkload);
    return {
      seat: s,
      children,
      open: (openOwn.get(s.project_id) ?? 0) + children.reduce((a, c) => a + c.open, 0),
      mine: (mineOwn.get(s.project_id) ?? 0) + children.reduce((a, c) => a + c.mine, 0),
      owed: (s.owed ?? 0) + children.reduce((a, c) => a + c.owed, 0),
      count: children.reduce((a, c) => a + c.count + 1, 0),
    };
  };

  const tree = roots.map(make);
  tree.sort(byWorkload);
  return tree;
}

// Filtering a tree is not filtering a list: a development stays on the board
// when the thing that matches is a job three levels down, or the row that
// leads you to it disappears.
export function prune(nodes: Node[], keep: (s: Seat) => boolean): Node[] {
  return nodes.reduce<Node[]>((out, n) => {
    const children = prune(n.children, keep);
    if (children.length > 0 || keep(n.seat)) out.push({ ...n, children });
    return out;
  }, []);
}

export const anyRuns = (n: Node): boolean => runs(n.seat) || n.children.some(anyRuns);

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
