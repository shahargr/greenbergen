"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { VIEW_HOME } from "./viewmap";

// The mask menu: remember which hat the admin picked and land them on that
// view's home. Several hats share a surface today (Contractor, PM and GC
// all work out of /contractor) - the cookie is what keeps the label honest.
export async function setView(role: string) {
  const home = VIEW_HOME[role];
  if (!home) return;
  const jar = await cookies();
  jar.set("gb_view", role, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  redirect(home);
}
