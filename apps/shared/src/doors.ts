// The four doors into Green Bergen.
//
// This module is PURE - no server imports - because ui.tsx renders the door
// pill and ui.tsx is imported by client components. Reading the doors from
// the database lives in doors.server.ts.
//
// These are four separate deployments on four URLs, sharing ONE Supabase Auth
// login and ONE app_users row. That is the fact the shell has to communicate:
// a person is not "a homeowner" the way they are a name - they are standing
// in the homeowner door, and the contractor door may also be open to them.
// Shahar holds three at once. So the pill says WHERE YOU ARE, and the
// switcher says where else you may go.
import { SITE_ORIGIN } from "./site";

export type DoorKey = "homeowner" | "expert" | "portal";

export type Door = {
  key: DoorKey;
  label: string;   // what the switcher and the picker say
  short: string;   // the line under the logo - has to fit beside a 15px wordmark
  full: string;    // what the switcher says
  blurb: string;   // why you would go there
  url: string;
};

// One host, four paths (see site.ts for why). NEXT_PUBLIC_DOOR_* still
// overrides any one of them if an app ever has to move.
const url = (env: string | undefined, fallback: string) => (env?.trim() ? env.trim() : fallback);

export const DOORS: Record<DoorKey, Door> = {
  homeowner: {
    key: "homeowner",
    label: "Homeowner",
    short: "Homeowner",
    full: "Your home",
    blurb: "Manage your home, DIY style or with vetted professionals.",
    url: url(process.env.NEXT_PUBLIC_DOOR_HOMEOWNER, `${SITE_ORIGIN}/home`),
  },
  // ONE door for everyone who works on homes. Project management is a trade
  // (migration 030), so a GC, a plumber and a project manager are the same
  // kind of member wearing different trades - not three kinds of person.
  expert: {
    key: "expert",
    label: "Professionals",
    short: "Professional",
    full: "Your work",
    blurb: "Service the community and run your projects.",
    url: url(process.env.NEXT_PUBLIC_DOOR_EXPERT, `${SITE_ORIGIN}/pro`),
  },
  portal: {
    key: "portal",
    label: "Admin",
    short: "Admin",
    full: "The portal",
    blurb: "Everything: admin, deals, the whole record.",
    url: url(process.env.NEXT_PUBLIC_DOOR_PORTAL, SITE_ORIGIN),
  },
};

export const DOOR_ORDER: DoorKey[] = ["homeowner", "expert", "portal"];

// How someone ADDS a door they do not hold yet. One login already covers all
// four, so this is never a second sign-up - it is the one screen that starts
// the record the door needs.
//
// builder and portal are absent on purpose. A builder seat ARRIVES: a project
// invites you as PM or GC, or a job of yours grows into one. There is no
// self-serve path and pretending otherwise would be a dead end. Admin is not
// something anyone adds to themselves.
export const JOIN: Partial<Record<DoorKey, { path: string; cta: string; how: string }>> = {
  homeowner: {
    path: "/packages",
    cta: "Add your home",
    how: "Pick a package and your home is created with it. Nothing to fill in first.",
  },
  expert: {
    path: "/join",
    cta: "Offer your trade",
    how: "Same account, same sign-in. Browsing is free; your documents gate the first job you accept.",
  },
};

export const NOT_SELF_SERVE: Partial<Record<DoorKey, string>> = {};

export type Doors = {
  signed_in: boolean;
  name: string | null;
  email: string | null;
  held: DoorKey[];
  // Whether the expert door should show the board, the tasks and the money.
  manages: boolean;
  contractor_status: string | null;
  // Where this person lands when they sign in, when they said (migration
  // 076). Null means the house rule: Professionals if they hold it, else
  // Homeowner, else the portal.
  default_door: DoorKey | null;
};

export type DoorsRow = {
  signed_in: boolean;
  name?: string | null;
  email?: string | null;
  homeowner?: boolean;
  expert?: boolean;
  manages?: boolean;
  admin?: boolean;
  contractor_status?: string | null;
  default_door?: string | null;
};

export const NO_DOORS: Doors = {
  signed_in: false, name: null, email: null, held: [], manages: false,
  contractor_status: null, default_door: null,
};

// my_doors() returns one boolean per door; the app wants them in a fixed
// order, because the switcher must not reshuffle itself between screens.
export function readDoors(data: DoorsRow | null): Doors {
  if (!data?.signed_in) return NO_DOORS;
  const has: Record<DoorKey, boolean | undefined> = {
    homeowner: data.homeowner, expert: data.expert, portal: data.admin,
  };
  return {
    signed_in: true,
    name: data.name ?? null,
    email: data.email ?? null,
    held: DOOR_ORDER.filter((k) => has[k]),
    manages: !!data.manages,
    contractor_status: data.contractor_status ?? null,
    default_door: DOOR_ORDER.find((k) => k === data.default_door) ?? null,
  };
}


// WHERE A PERSON LANDS, in one place so the three apps cannot disagree.
//
// Shahar (2026-09-12): "each user should have a default landing even if they
// own multiple roles... home owner alone: land on home owner tab. home owner
// and pro: default professional - able to update the default in settings."
//
// So: their own choice when they have made one and still hold that door, else
// the working door, else the homeowner one, else the portal. Admin is never
// the answer for somebody who holds another door - it is reached from the
// mask in the top bar, and only shows there for somebody who has it.
const LANDS: DoorKey[] = ["expert", "homeowner", "portal"];

export function landingDoor(doors: Doors): DoorKey | null {
  if (!doors.signed_in) return null;
  if (doors.default_door && doors.held.includes(doors.default_door)) return doors.default_door;
  return LANDS.find((k) => doors.held.includes(k)) ?? null;
}
