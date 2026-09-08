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
export type DoorKey = "homeowner" | "contractor" | "builder" | "portal";

export type Door = {
  key: DoorKey;
  label: string;   // what the pill says
  full: string;    // what the switcher says
  blurb: string;   // why you would go there
  url: string;
};

// Set NEXT_PUBLIC_DOOR_* in Vercel to move an app without a code change; the
// production URLs are the fallback so nothing breaks if one is unset.
const url = (env: string | undefined, fallback: string) => (env?.trim() ? env.trim() : fallback);

export const DOORS: Record<DoorKey, Door> = {
  homeowner: {
    key: "homeowner",
    label: "Homeowner",
    full: "Your home",
    blurb: "Price a package, book it, follow the job.",
    url: url(process.env.NEXT_PUBLIC_DOOR_HOMEOWNER, "https://greenbergen-homeowner.vercel.app"),
  },
  contractor: {
    key: "contractor",
    label: "Contractor",
    full: "Your trade",
    blurb: "Offers at the community price, your jobs, your documents.",
    url: url(process.env.NEXT_PUBLIC_DOOR_CONTRACTOR, "https://greenbergen-contractor.vercel.app"),
  },
  builder: {
    key: "builder",
    label: "Builder",
    full: "Your board",
    blurb: "Run the job: scope, bids, crew, money.",
    url: url(process.env.NEXT_PUBLIC_DOOR_BUILDER, "https://greenbergen-builder.vercel.app"),
  },
  portal: {
    key: "portal",
    label: "Admin",
    full: "The portal",
    blurb: "Everything: admin, deals, the whole record.",
    url: url(process.env.NEXT_PUBLIC_DOOR_PORTAL, "https://greenbergen.vercel.app"),
  },
};

export const DOOR_ORDER: DoorKey[] = ["homeowner", "contractor", "builder", "portal"];

export type Doors = {
  signed_in: boolean;
  name: string | null;
  email: string | null;
  held: DoorKey[];
  contractor_status: string | null;
};

export type DoorsRow = {
  signed_in: boolean;
  name?: string | null;
  email?: string | null;
  homeowner?: boolean;
  contractor?: boolean;
  builder?: boolean;
  admin?: boolean;
  contractor_status?: string | null;
};

export const NO_DOORS: Doors = {
  signed_in: false, name: null, email: null, held: [], contractor_status: null,
};

// my_doors() returns one boolean per door; the app wants them in a fixed
// order, because the switcher must not reshuffle itself between screens.
export function readDoors(data: DoorsRow | null): Doors {
  if (!data?.signed_in) return NO_DOORS;
  const has: Record<DoorKey, boolean | undefined> = {
    homeowner: data.homeowner, contractor: data.contractor,
    builder: data.builder, portal: data.admin,
  };
  return {
    signed_in: true,
    name: data.name ?? null,
    email: data.email ?? null,
    held: DOOR_ORDER.filter((k) => has[k]),
    contractor_status: data.contractor_status ?? null,
  };
}
