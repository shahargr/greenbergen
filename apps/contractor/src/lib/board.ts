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
  // A standing household project (insurance, mortgage, taxes, internet):
  // the owner's, not the site's. The board leaves these out (migration 061).
  household: boolean;
  seat: string | null; rank: number; my_open_tasks: number;
  bid_amount: number | null; latest_bid_id: string | null;
  owed: number; owed_count: number; buckets: string[];
  // The storage path of the project's face (migrations 032, 062, 063): its
  // chosen cover, else the house's, else its newest photo that is not money
  // evidence. A path, not a URL: sign it with coverUrls() so the whole page
  // costs one round trip. cover_own says the cover is this project's own
  // choice rather than one borrowed from the house above it.
  cover: string | null;
  cover_own: boolean;
  // The JOB TYPE's picture (migration 071): a public url, already usable,
  // set when this project is one of the catalogue's packages and nobody has
  // chosen a photo of its own. A generator job looks like a generator.
  cover_url: string | null;
  package_code: string | null;
};

// The one place that decides which of a seat's two faces to show. The job
// type's picture is already a url; the other is a private path that has to
// be signed, so a screen signs what it has and asks here.
export const faceUrl = (s: Seat, signed: Record<string, string>) =>
  s.cover_url ?? signed[s.cover ?? ""] ?? null;

export type Task = {
  id: string; action: string; status: string; priority: string | null;
  target_date: string | null; last_updated: string | null; notes: string | null;
  project: string | null; project_id: string | null; domain: string | null;
  has_contract: boolean; state: "open" | "closed";
  assignee_id: string | null; assignee: string | null; trade: string | null;
  // The three ways a build's work divides up (migration 066). Each is null
  // on most tasks - see groupTasks below, which says so on screen rather
  // than pretending otherwise.
  contract_id: string | null; contract: string | null;
  phase: string | null; phase_order: number | null;
  completed_on: string | null;
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

// closed: how many finished tasks to bring back with the open ones. The
// board and the task list only ever count open work, so they pay nothing for
// it and ask for none; a project screen that offers "Done" asks for them
// (Shahar, 2026-09-11: "i need to see completed as well").
export async function getBoard({ closed = 0 }: { closed?: number } = {}): Promise<Board> {
  const supabase = await createClient();
  const { data: claimsData } = await timed("me.claims", () => supabase.auth.getClaims());
  const claims = claimsData?.claims as { sub?: string; email?: string } | undefined;
  if (!claims?.sub) return { signed_in: false, me: null, seats: [], tasks: [] };

  // None of the three depends on another, so they leave together.
  const [{ data: me, error: meErr }, { data: work }, { data: tasks }] = await Promise.all([
    timed("me", () => rpc<Me>(supabase, "me")),
    timed("work", () => rpc<Seat[]>(supabase, "portal_my_work")),
    // The board counts open work per project out of this one read, so the
    // limit has to sit above the real total or the roll-up silently
    // undercounts and the sort goes wrong. 164 open today; 500 is headroom.
    timed("tasks", () => rpc<Task[]>(supabase, "portal_tasks", { p_domain: "construction", p_closed_limit: closed, p_open_limit: 500 })),
  ]);
  if (meErr) console.error("me:", meErr.message);

  // Household projects (insurance, mortgage, taxes...) are the homeowner's
  // business; a contractor's board shows the jobs (Shahar, 2026-09-11:
  // "show only tasks that are project related"). Their tasks go with them.
  const seats = (Array.isArray(work) ? work : []).filter((s) => !s.household);
  const household = new Set((Array.isArray(work) ? work : []).filter((s) => s.household).map((s) => s.project_id));
  const kept = (Array.isArray(tasks) ? tasks : []).filter((t) => !t.project_id || !household.has(t.project_id));
  return {
    signed_in: true,
    me: me ?? { app_user_id: claims.sub, contact_id: null, full_name: null, email: claims.email ?? null, is_superadmin: false },
    seats,
    tasks: kept,
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

// OPEN WORK AT OR BENEATH EVERY PROJECT.
//
// A container carries no tasks of its own - fn_actions_not_on_property sees
// to that, and the work lives on the jobs beneath it. So counting the rows ON
// 55 Walnut says nobody has started, while eleven jobs under it are busy, and
// a screen that reads those counts calls a live house "not started". Any
// count a screen shows ABOUT a project is the family's, never the row's.
export function openBeneath(seats: Seat[], tasks: Task[]): Map<string, number> {
  const own = new Map<string, number>();
  for (const t of tasks) {
    if (t.state !== "open" || !t.project_id) continue;
    own.set(t.project_id, (own.get(t.project_id) ?? 0) + 1);
  }
  const kids = new Map<string, string[]>();
  for (const s of seats) {
    if (!s.parent_project_id) continue;
    kids.set(s.parent_project_id, [...(kids.get(s.parent_project_id) ?? []), s.project_id]);
  }
  const out = new Map<string, number>();
  // open guards a parent chain that loops back on itself - a bad row should
  // make a count wrong, never make the page hang.
  const open = new Set<string>();
  const walk = (id: string): number => {
    const done = out.get(id);
    if (done !== undefined) return done;
    if (open.has(id)) return own.get(id) ?? 0;
    open.add(id);
    const n = (own.get(id) ?? 0) + (kids.get(id) ?? []).reduce((a, k) => a + walk(k), 0);
    out.set(id, n);
    return n;
  };
  for (const s of seats) walk(s.project_id);
  return out;
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

// Which property a job belongs to. The task list groups by this, so it has
// to agree with the board: when every seat hangs off one root, that root is
// the board rather than a row on it, and the top level is one step down.
export function topLevels(seats: Seat[]): { map: Map<string, Seat>; roof: Seat | null } {
  const byId = new Map(seats.map((s) => [s.project_id, s]));
  const rootIds = seats
    .filter((s) => !(s.parent_project_id && byId.has(s.parent_project_id)))
    .map((s) => s.project_id);
  const roof = rootIds.length === 1 ? byId.get(rootIds[0]!) ?? null : null;

  const map = new Map<string, Seat>();
  for (const s of seats) {
    const chain: Seat[] = [s];
    const seen = new Set([s.project_id]);
    let cur = s;
    while (cur.parent_project_id && byId.has(cur.parent_project_id) && !seen.has(cur.parent_project_id)) {
      cur = byId.get(cur.parent_project_id)!;
      seen.add(cur.project_id);
      chain.unshift(cur);
    }
    map.set(s.project_id, roof && chain.length > 1 ? chain[1]! : chain[0]!);
  }
  return { map, roof };
}

// High first, then Medium, then anything unset, then Low - an unset priority
// is unknown, not unimportant, so it must not sort below Low.
export const PRIORITY = ["High", "Medium", "Low"] as const;
export const priorityRank = (p: string | null) =>
  p === "High" ? 0 : p === "Medium" ? 1 : p === "Low" ? 3 : 2;

// The buckets are computed in the database (active, lead, decision, payment,
// done); the app only names them. "done" reads as Completed on screen - it
// is the status word the projects table uses ("Closed - Completed") and the
// word Shahar uses - and it is the one bucket the board hides by default.
export const BUCKETS = [
  { key: "active", label: "Active" },
  { key: "decision", label: "Needs a decision" },
  { key: "payment", label: "Money" },
  { key: "lead", label: "Leads" },
  { key: "done", label: "Completed" },
] as const;
export type BucketKey = (typeof BUCKETS)[number]["key"] | "all";

export const money = (n: number | null | undefined) =>
  n == null || n === 0 ? null : `$${Math.round(n).toLocaleString()}`;

// ---------------------------------------------------------------------------
// TASK BUCKETS.
//
// A project's open work is never a rolling list. 122 of the open tasks in
// this database sit on one job, and a list that long answers no question at
// all - you scroll it looking for the one thing that is late.
//
// The seat BUCKETS above sort PROPERTIES by what is happening to them
// commercially. These sort TASKS by what they need from you, which is a
// different question with a different answer:
//
//   late     - past its date. Nothing else matters until this is empty.
//   week     - due in the next seven days. What today is actually about.
//   waiting  - parked, or pending someone else. Yours to chase, not to do.
//   later    - dated, further out. Visible, closed by default.
//   undated  - no date at all. Real work nobody has committed to.
//
// The order IS the design: a bucket only appears when it has rows, and the
// first two carry the day. Same idea the /tasks screen already runs on
// (late first, then dated, then undated) - named here so the project screen
// and the task list can never drift apart.
export const TASK_BUCKETS = [
  { key: "late", label: "Late", tone: "status" },
  { key: "week", label: "This week", tone: null },
  { key: "waiting", label: "Waiting on someone", tone: null },
  { key: "later", label: "Later", tone: null },
  { key: "undated", label: "No date yet", tone: null },
] as const;
export type TaskBucket = (typeof TASK_BUCKETS)[number]["key"];

const WAITING = ["Parked", "Pending on Others", "Completed Pending Approval", "Completed Pending"];

export function taskBucket(t: Task, today: string, weekEnd: string): TaskBucket {
  if (t.target_date && t.target_date < today) return "late";
  if (WAITING.includes(t.status)) return "waiting";
  if (!t.target_date) return "undated";
  return t.target_date <= weekEnd ? "week" : "later";
}

// Group a project's open work into the buckets above, dropping the empty
// ones. Inside a bucket: soonest first, then by priority - an undated task
// has nothing else to order it by.
export function bucketTasks(tasks: Task[], now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const weekEnd = new Date(now.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
  const out = new Map<TaskBucket, Task[]>();
  for (const t of tasks) {
    const k = taskBucket(t, today, weekEnd);
    out.set(k, [...(out.get(k) ?? []), t]);
  }
  for (const rows of out.values()) {
    rows.sort((a, b) =>
      (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") ||
      priorityRank(a.priority) - priorityRank(b.priority) ||
      a.action.localeCompare(b.action));
  }
  return TASK_BUCKETS
    .map((b) => ({ ...b, rows: out.get(b.key) ?? [] }))
    .filter((b) => b.rows.length > 0);
}

// ---------------------------------------------------------------------------
// SECTIONS. Shahar (2026-09-11): "all tasks should be in sections under
// trade, contract, building phase. check the data we have and decide what is
// best."
//
// What the data says, counted on the one project that has real volume (55
// Walnut's New build, 254 tasks in the construction domain):
//
//     a trade      63   (25%)   - from its contract, its scope line, or its person
//     a phase      60   (24%)   - a trade's stage; no trade, no phase
//     a contract   25   (10%)
//
// So none of the three can be the only arrangement: each files three tasks in
// four under "not recorded". TIMING stays the default, because every task has
// one and it answers the question a person on site is actually asking. The
// other three are groupings you switch to, and what is untagged gathers in a
// named section at the bottom with its count - which is the useful thing,
// since that section IS the list of what still needs tagging.
export type GroupKey = "timing" | "trade" | "contract" | "phase";
export const GROUPINGS: { key: GroupKey; label: string }[] = [
  { key: "timing", label: "Timing" },
  { key: "trade", label: "Trade" },
  { key: "contract", label: "Contract" },
  { key: "phase", label: "Phase" },
];

export type Section = { key: string; label: string; tone: "status" | null; rows: Task[]; late: number };

// Inside every section, whatever the grouping: what is late first, then by
// date, then by priority. A finished task sorts by when it finished.
const withinSection = (a: Task, b: Task) => {
  if (a.state !== b.state) return a.state === "open" ? -1 : 1;
  if (a.state === "closed") {
    return (b.completed_on ?? b.last_updated ?? "").localeCompare(a.completed_on ?? a.last_updated ?? "");
  }
  return (a.target_date ?? "9999").localeCompare(b.target_date ?? "9999") ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    a.action.localeCompare(b.action);
};

export function groupTasks(tasks: Task[], by: GroupKey, now = new Date()): Section[] {
  const today = now.toISOString().slice(0, 10);
  const isLate = (t: Task) => t.state === "open" && !!t.target_date && t.target_date < today;

  if (by === "timing") {
    // A finished task has no timing left - it has an ending, so it gets one
    // section of its own at the foot of the list.
    const open = tasks.filter((t) => t.state === "open");
    const done = tasks.filter((t) => t.state === "closed");
    const sections: Section[] = bucketTasks(open, now).map((b) => ({
      key: b.key, label: b.label, tone: b.tone,
      rows: b.rows, late: b.rows.filter(isLate).length,
    }));
    if (done.length > 0) {
      sections.push({ key: "done", label: "Done", tone: null, rows: [...done].sort(withinSection), late: 0 });
    }
    return sections;
  }

  // The other three read one field each, and each has an "unset" bucket that
  // says what is missing rather than hiding it.
  const of = (t: Task) =>
    by === "trade" ? t.trade
    : by === "contract" ? t.contract
    : t.phase;
  const missing =
    by === "trade" ? "No trade recorded"
    : by === "contract" ? "Not under a contract"
    : "No phase recorded";

  const map = new Map<string, Task[]>();
  for (const t of tasks) {
    const k = of(t) ?? "";
    map.set(k, [...(map.get(k) ?? []), t]);
  }

  // Phase runs in the order a build runs in (trade_stages.sort_order);
  // trades and contracts have no natural order, so they run by weight - the
  // section with the most work first, which is where a person looks.
  const order = (a: [string, Task[]], b: [string, Task[]]) => {
    if (a[0] === "") return 1;
    if (b[0] === "") return -1;
    if (by === "phase") {
      const pa = a[1][0]?.phase_order ?? 9999;
      const pb = b[1][0]?.phase_order ?? 9999;
      if (pa !== pb) return pa - pb;
    }
    const la = a[1].filter(isLate).length;
    const lb = b[1].filter(isLate).length;
    return lb - la || b[1].length - a[1].length || a[0].localeCompare(b[0]);
  };

  return [...map.entries()].sort(order).map(([k, rows]) => ({
    key: k || "unset",
    label: k || missing,
    tone: null,
    rows: [...rows].sort(withinSection),
    late: rows.filter(isLate).length,
  }));
}

// One signed-URL round trip for every cover on a page. Storage paths are
// private; a signed URL lasts an hour, which outlives any page view.
export async function coverUrls(
  supabase: Awaited<ReturnType<typeof createClient>>, paths: (string | null)[],
): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter((p): p is string => !!p))];
  if (unique.length === 0) return {};
  const { data } = await timed("coverUrls", () =>
    supabase.storage.from("project-media").createSignedUrls(unique, 3600));
  const out: Record<string, string> = {};
  for (const row of data ?? []) if (row.path && row.signedUrl) out[row.path] = row.signedUrl;
  return out;
}
