// The line under the portal logo: not the seat's database name but what it
// means to the person wearing it, short enough to sit under a 17px wordmark.
//
//   asset owner                          -> HOMES
//   site GC, site project manager,
//   contractor manager                   -> PROJECT M.
//   contractor, sub-contractor(-manager),
//   crew                                 -> CONTRACTOR
//   viewer, any rank-0 seat, no seat     -> VISITOR (ADMIN if a superadmin)
//
// Pure, so the server (TopNav's first paint) and the client (NavRole, which
// re-reads the seat when the route moves onto a project) say the same word.
// The seat names are project_roles.role values; the ranks come from the same
// table and are passed in rather than duplicated here (rulebook 03 - the
// vocabulary lives in ONE table).
export type SeatLabel = "Homes" | "Project M." | "Contractor" | "Visitor" | "Admin";

const RUNS_THE_SITE = new Set(["site GC", "site project manager", "contractor manager"]);
const WORKS_THE_TRADE = new Set(["contractor", "sub-contractor manager", "sub-contractor", "crew"]);

export function seatLabel(seats: string[], ranks: Record<string, number>, admin: boolean): SeatLabel {
  const top = [...seats].sort((a, b) => (ranks[b] ?? 0) - (ranks[a] ?? 0))[0];
  if (top === "asset owner") return "Homes";
  if (top && RUNS_THE_SITE.has(top)) return "Project M.";
  if (top && WORKS_THE_TRADE.has(top)) return "Contractor";
  return admin ? "Admin" : "Visitor";
}
