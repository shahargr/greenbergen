import { createClient } from "@/lib/supabase/server";
import { rpcRetry } from "@/lib/rpc";

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
// ADMIN IS A DOOR, NOT A BYPASS. It used to short-circuit: any admin went
// straight to the portal and was never asked. That is wrong for the person
// it most affects - Shahar holds all four, and being an admin is the LEAST
// likely reason he is signing in on a given morning. So admin now takes its
// place in the list and gets chosen like the others.
export type DoorKey = "homeowner" | "contractor" | "builder" | "admin";

export const DOOR_URL: Record<DoorKey, string> = {
  homeowner: process.env.NEXT_PUBLIC_DOOR_HOMEOWNER?.trim() || "https://greenbergen-homeowner.vercel.app",
  contractor: process.env.NEXT_PUBLIC_DOOR_CONTRACTOR?.trim() || "https://greenbergen-contractor.vercel.app",
  builder: process.env.NEXT_PUBLIC_DOOR_BUILDER?.trim() || "https://greenbergen-builder.vercel.app",
  // The portal is this app, so its door is a path rather than a URL.
  admin: "/my",
};

// Named the way Shahar names them out loud - homeowner, contractor, project
// manager, admin - rather than the app's internal key. "builder" is the
// deployment; "project manager" is the person.
export const DOOR_LABEL: Record<DoorKey, { title: string; blurb: string }> = {
  homeowner: { title: "Homeowner", blurb: "Price a package, book it, follow the job." },
  contractor: { title: "Contractor", blurb: "Offers at the community price, your jobs, your documents." },
  builder: { title: "Project manager", blurb: "Run the job: scope, bids, crew, money." },
  admin: { title: "Admin", blurb: "The whole record: everyone's projects, deals, the portal." },
};

// The order a person is offered their doors in, and the order the single-door
// shortcut resolves. Homeowner first because it is the widest audience; admin
// last because it is the rarest reason to be here.
export const DOOR_ORDER: DoorKey[] = ["homeowner", "contractor", "builder", "admin"];

export type Doors = { signed_in: boolean; admin: boolean; held: DoorKey[] };

type Row = {
  signed_in?: boolean; admin?: boolean;
  homeowner?: boolean; contractor?: boolean; builder?: boolean;
};

export async function loadDoors(): Promise<Doors> {
  const supabase = await createClient();
  const { data, error } = await rpcRetry<Row>(supabase, "my_doors");
  if (error || !data?.signed_in) return { signed_in: false, admin: false, held: [] };
  const has: Record<DoorKey, boolean | undefined> = {
    homeowner: data.homeowner, contractor: data.contractor, builder: data.builder, admin: data.admin,
  };
  return { signed_in: true, admin: !!data.admin, held: DOOR_ORDER.filter((k) => has[k]) };
}

// One door resolves straight through. More than one and we ask - guessing
// costs a person a wrong app and a hunt for the switcher, and the ask costs
// them one tap.
export function landing(doors: Doors): string {
  if (!doors.signed_in) return "/login";
  if (doors.held.length === 1) return DOOR_URL[doors.held[0]!];
  if (doors.held.length > 1) return "/choose";
  return "/my"; // no door yet - a new account still has the portal to land in
}
