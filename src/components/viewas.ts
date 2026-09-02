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

// Admin-only impersonation (begin_view_as checks superadmin in the
// database; sessions expire after an hour). Read-mostly by design:
// write RPCs refuse while borrowing.
export async function beginViewAs(userId: string) {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("begin_view_as", { p_as_user_id: userId });
  if (error || !data?.ok) {
    redirect(`/admin/users?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not switch.")}`);
  }
  redirect("/my");
}

export async function endViewAs() {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.rpc("end_view_as");
  redirect("/admin/users");
}
