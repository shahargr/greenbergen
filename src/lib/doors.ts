// Where a person belongs after they sign in.
//
// One Supabase Auth login sits behind four deployments. The portal is the
// door people have always arrived at, but for most of them it is now the
// wrong one - a homeowner wants the homeowner app, a trade wants the
// contractor app, someone running a job wants the builder app. my_doors()
// answers which of those are open to them in one read.
//
// This is ROUTING, not a gate: /my and everything under it still works if
// you go there directly. Nothing is taken away here.
//
// THERE IS NO PICKER ANY MORE (Shahar, 2026-09-12): "i think this is an
// un-necessary step. each user should have a default landing even if they own
// multiple roles... so this screen can be deleted completely."
//
// The picker was built on "guessing costs a person a wrong app and a hunt for
// the switcher". But it is not a guess: somebody who works on homes signs in
// to work, and being an admin is the least likely reason anybody is here on a
// given morning. One screen, on every sign-in, asking a question with an
// obvious answer.
//
// THE HOUSE RULE: Professionals if they hold it, else Homeowner, else the
// portal (admin only, or an account with no door yet). app_users.default_door
// overrides it, set from any app's settings; a door somebody no longer holds
// is ignored rather than stranding them. Admin is never the house rule's
// answer for somebody who holds another door - it is reached from the
// switcher in the top bar, and only shows there if they actually have it.
export type DoorKey = "homeowner" | "expert" | "admin";

// One host, four paths: the three apps are proxied under this portal's own
// origin (rewrites in next.config.ts), because a session cookie cannot cross
// vercel.app hosts and "one login, four doors" has to be true in the browser
// too. Paths, not URLs, so a hop stays on this origin and keeps its cookie.
export const DOOR_URL: Record<DoorKey, string> = {
  homeowner: process.env.NEXT_PUBLIC_DOOR_HOMEOWNER?.trim() || "/home",
  expert: process.env.NEXT_PUBLIC_DOOR_EXPERT?.trim() || "/pro",
  admin: "/my",
};

// WHERE A HOP LANDS: the INSIDE of the door, never its front page.
//
// The front page is a sales pitch, and worse, it redirects - the homeowner
// root sends a signed-in person to the door they belong in, so pointing the
// switcher at it handed somebody straight back to where they were trying to
// leave (Shahar, 2026-09-12: "even when i click home owner i land on
// professional"). A person who picks a door has already decided.
//
// Straight in, not via the app's sign-in: the three apps are proxied under
// this one origin now (rewrites in next.config.ts), so the session cookie
// already travels. The ?next= hop was from the days of separate vercel.app
// hosts, and it only added a redirect.
export const DOOR_ENTRY: Record<DoorKey, string> = {
  homeowner: `${DOOR_URL.homeowner}/project`,
  expert: `${DOOR_URL.expert}/work`,
  admin: "/my",
};

// Named the way Shahar names them out loud - homeowner, contractor, project
// experts, admin - one door for everyone who works on homes.
export const DOOR_LABEL: Record<DoorKey, { title: string; blurb: string }> = {
  homeowner: { title: "Homeowner", blurb: "Manage your home, DIY style or with vetted professionals." },
  // One door. Project management is a trade you offer, not a different you.
  expert: { title: "Professionals", blurb: "Service the community and run your projects." },
  admin: { title: "Admin", blurb: "The whole record: everyone's projects, deals, the portal." },
};

// The order the switcher lists them in. Homeowner first because it is the
// widest audience; admin last because it is the rarest reason to be here.
export const DOOR_ORDER: DoorKey[] = ["homeowner", "expert", "admin"];

export type Doors = { signed_in: boolean; admin: boolean; held: DoorKey[]; preferred: DoorKey | null };

export type DoorsRow = {
  signed_in?: boolean; admin?: boolean;
  homeowner?: boolean; expert?: boolean;
  // app_users.default_door (migration 076). 'expert' here is the same door
  // the apps call Professionals; 'portal' is what the portal calls admin.
  default_door?: string | null;
};

// THE HOUSE RULE, in the order it resolves: you come to work, so the working
// door wins. Admin is last and is never chosen for somebody who holds another
// door - it is reached from the mask in the top bar, and only shows there for
// somebody who actually has it.
const LANDS: DoorKey[] = ["expert", "homeowner", "admin"];

// Pure, so the door mask (a client component) can read the labels and the
// entry paths without dragging the server's Supabase client into the browser
// bundle. Reading the doors from the database lives in doors.server.ts.
export function readDoors(data: DoorsRow | null): Doors {
  if (!data?.signed_in) return { signed_in: false, admin: false, held: [], preferred: null };
  const has: Record<DoorKey, boolean | undefined> = {
    homeowner: data.homeowner, expert: data.expert, admin: data.admin,
  };
  // The column says 'portal' where this app says 'admin' - one door, two
  // names for it, and the translation lives here rather than in four screens.
  const raw = data.default_door === "portal" ? "admin" : data.default_door;
  const preferred = DOOR_ORDER.find((k) => k === raw) ?? null;
  return { signed_in: true, admin: !!data.admin, held: DOOR_ORDER.filter((k) => has[k]), preferred };
}

// Every sign-in resolves straight through. Their own choice when they have
// made one and still hold it, else the house rule, else the portal - which a
// brand new account with no door at all still has.
export function landing(doors: Doors): string {
  if (!doors.signed_in) return "/login";
  const chosen = doors.preferred && doors.held.includes(doors.preferred) ? doors.preferred : null;
  const door = chosen ?? LANDS.find((k) => doors.held.includes(k)) ?? null;
  return door ? DOOR_ENTRY[door] : "/my";
}
