// HOW A PROJECT LOOKS FROM WHERE YOU STAND.
//
// Shahar (2026-09-13): "When i'm a GC I need to be able to quickly see the GC
// view on the project. the contractor needs a view on the project - from this
// week tasks, to logging payments, and adding site visit. Once I enter a
// project (does not work well), allow me to log in as GC / Professional /
// home owner / investor / viewer. This currently does not work."
//
// One project screen served everybody the same nine panels in the same order,
// and the order was the owner's: bids and money first, the week and the visit
// somewhere down the grid. A trade arriving on site wants three things and
// none of them is the bid book.
//
// So the screen has a LENS. It changes which panels are offered, in what
// order, and where the screen opens - nothing else.
//
// A LENS IS NOT A PERMISSION. It only ever narrows what is DRAWN; every read
// on the screen still goes through the same database functions with the same
// gates, so taking the Investor lens does not show you money the ladder does
// not already let you see, and taking the Viewer lens does not hide anything
// from anybody but you. That is why the switcher can be honest about it and
// why offering it costs nothing: worst case a lens shows you an empty panel.
//
// Which lenses you may take: your own, and any at or below your authority
// rank (project_roles.authority_rank). Looking DOWN the ladder is how you
// check what your trades see; looking up would only ever be theatre, since
// the database would return nothing.

export type PanelKey =
  | "tasks" | "bids" | "money"
  | "jobs-open" | "jobs-working" | "jobs-done"
  | "week" | "visits" | "soon";

export type LensKey = "owner" | "gc" | "pm" | "pro" | "investor" | "viewer";

export type Lens = {
  key: LensKey;
  label: string;   // the chip
  full: string;    // what it is, in a line
  rank: number;    // the authority it stands at (project_roles.authority_rank)
  first: PanelKey; // where the screen opens
  panels: PanelKey[];
  // Whether this lens leads with the three things somebody working on site
  // actually does: the week, what they spent, and their visit.
  onSite: boolean;
};

export const LENSES: Record<LensKey, Lens> = {
  owner: {
    key: "owner", label: "Owner", rank: 70,
    full: "The whole job — the work, the money, the bids and the decisions",
    first: "week", onSite: false,
    panels: ["week", "tasks", "money", "bids", "jobs-open", "jobs-working", "jobs-done", "visits", "soon"],
  },
  gc: {
    key: "gc", label: "GC", rank: 60,
    full: "Running the site — this week first, then the work, the money and the bids",
    first: "week", onSite: true,
    panels: ["week", "tasks", "visits", "money", "bids", "jobs-open", "jobs-working", "jobs-done", "soon"],
  },
  pm: {
    key: "pm", label: "Project manager", rank: 50,
    full: "Day to day — the week, the work, the visits",
    first: "week", onSite: true,
    panels: ["week", "tasks", "visits", "jobs-open", "jobs-working", "jobs-done", "bids", "soon"],
  },
  pro: {
    key: "pro", label: "Professional", rank: 30,
    full: "Your trade on this site — this week, what you spent, and your visit",
    first: "week", onSite: true,
    panels: ["week", "tasks", "visits", "soon"],
  },
  investor: {
    key: "investor", label: "Investor", rank: 1,
    full: "The money and the progress, never the day to day",
    first: "money", onSite: false,
    panels: ["money", "jobs-working", "jobs-done", "jobs-open", "tasks"],
  },
  viewer: {
    key: "viewer", label: "Viewer", rank: 0,
    full: "Progress and schedule, never the money",
    first: "week", onSite: false,
    panels: ["week", "tasks", "jobs-working", "jobs-open", "jobs-done"],
  },
};

// Ladder order, highest first - the switcher must not reshuffle itself
// between screens.
export const LENS_ORDER: LensKey[] = ["owner", "gc", "pm", "pro", "investor", "viewer"];

// WHICH LENS YOU ARE. portal_my_work hands over both the seat's name and its
// authority rank, so this costs no read: the rank IS the ladder
// (asset owner 70, site GC 60, site PM 50, contractor manager 40, contractor
// 30, sub 10-20, crew 5, everyone else 0), and the name only has to settle
// the rank-0 seats, where Investor and Partner see money and a viewer does
// not.
export function lensOf(seat: string | null, rank: number): LensKey {
  if (rank >= 70) return "owner";
  if (rank >= 60) return "gc";
  if (rank >= 50) return "pm";
  // Crew sit at 5 and see only their own tasks. The database enforces that;
  // the Professional lens is the right SHAPE for them either way - the week,
  // their work, their visit.
  if (rank >= 5) return "pro";
  const s = (seat ?? "").toLowerCase();
  if (s.includes("investor") || s.includes("partner") || s.includes("owner")) return "investor";
  return "viewer";
}

// WHICH LENSES YOU MAY TAKE: your own, and anything at or below it. A
// superadmin may take any of them, which is the only way to check what a
// screen looks like for somebody whose seat you do not hold.
export function lensesFor(actual: LensKey, superadmin: boolean): Lens[] {
  const mine = LENSES[actual];
  return LENS_ORDER.map((k) => LENSES[k])
    .filter((l) => superadmin || l.key === actual || l.rank <= mine.rank);
}

export const readLens = (raw: string | undefined, allowed: Lens[], actual: LensKey): Lens =>
  allowed.find((l) => l.key === raw) ?? LENSES[actual];
