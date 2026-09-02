"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

// The mask menu: remember which hat the user picked and land them on that
// view's home. Several hats share a surface today (Contractor, PM and GC
// all work out of /contractor) - the cookie is what keeps the label honest.
export const VIEW_HOME: Record<string, string> = {
  Owner: "/my",
  Contractor: "/contractor",
  PM: "/contractor",
  GC: "/contractor",
  Admin: "/admin",
};

export async function setView(role: string) {
  const home = VIEW_HOME[role];
  if (!home) return;
  const jar = await cookies();
  jar.set("gb_view", role, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect(home);
}
