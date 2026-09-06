"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { VIEW_HOME } from "./viewmap";

// The mask menu: remember which hat the admin picked and land them on that
// view's home. Several hats share a surface today (Contractor, PM and GC
// all work out of /contractor) - the cookie is what keeps the label honest.
export async function setView(role: string) {
  const home = VIEW_HOME[role];
  if (!home) return;
  const jar = await cookies();
  jar.set("gb_view", role, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  redirect(home);
}

// Admin-only impersonation. begin_view_as checks superadmin on the REAL
// person in the database; sessions expire after an hour. Two modes:
//   view - their eyes only; the write RPCs refuse (assert_own_hands)
//   act  - every change lands as them, and the change log names you
// The redirect keeps you on the page you were on.
function safePath(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/my";
}
function withError(path: string, msg: string) {
  return `${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`;
}

export async function beginViewAs(userId: string, canAct = false, next?: string) {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const back = safePath(next);
  const { data, error } = await supabase.rpc("begin_view_as", { p_as_user_id: userId, p_can_act: canAct });
  // The identity changed, so nothing Next has cached - the top bar above
  // all - may be shown again. Layout-wide, before the redirect.
  revalidatePath("/", "layout");
  if (error || !data?.ok) {
    redirect(withError(back, data?.reason ?? error?.message ?? "Could not switch."));
  }
  redirect(back);
}

export async function endViewAs(next?: string) {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  await supabase.rpc("end_view_as");
  revalidatePath("/", "layout");
  redirect(safePath(next));
}

// The god-mode pickers post a form: who, view or act, and where to return.
export async function becomeUser(formData: FormData) {
  const userId = String(formData.get("user") ?? "");
  const mode = String(formData.get("mode") ?? "view");
  const back = String(formData.get("back") ?? "/my");
  if (!/^[0-9a-f-]{36}$/i.test(userId)) redirect(withError(safePath(back), "Pick a person first."));
  await beginViewAs(userId, mode === "act", back);
}
