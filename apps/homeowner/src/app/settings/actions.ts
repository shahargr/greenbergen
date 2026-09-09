"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// Sign out. Supabase clears the session cookie through the server client, so
// the proxy and every screen see the same thing on the very next request.
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

// Bring someone onto a PROPERTY - not one job, the house and everything
// under it. portal_invite_to_project already did this for any project and a
// home is a project; what it lacked until migration 031 was a seat for the
// person who runs the place, so a property manager arrived as a viewer.
//
// The four seats, in the words a homeowner uses:
//   member   - a spouse or co-owner: everything you can do, money included
//   manager  - a property manager: runs the work, gets the board
//   contractor - the seat a pro works from
//   viewer   - a tenant, a designer: sees it, never the money
//
// Nobody is added silently: this writes a pending invitation they accept
// from their own inbox.
export async function inviteToHome(projectId: string, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const seat = String(formData.get("seat") ?? "viewer");
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_invite_to_project", {
    p_project: projectId, p_email: email, p_phone: phone, p_seat: seat, p_note: note,
  });
  revalidatePath("/settings");
  if (error || !data?.ok) redirect(`/settings?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not send that invitation."))}`);
  redirect(`/settings?invited=${encodeURIComponent(data.name ?? "them")}`);
}

// The homes list is managed HERE, not on the project page. Rename or fix the
// address; homeowner_home_update checks ownership through the same
// homeowner_home_ids() the rest of the app uses.
export async function saveHome(projectId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_home_update", { p_project: projectId, p_name: name, p_address: address });
  if (error || !data?.ok) redirect(`/settings?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not save the home."))}`);
  revalidatePath("/settings"); revalidatePath("/project");
  redirect("/settings");
}

// Off the account: trash_own_project is the existing, reversible path
// (purged by the nightly job after the retention window). The button only
// renders when nothing is live on the home; the function is the real guard.
export async function removeHome(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trash_own_project", { p_project_id: projectId });
  if (error || (data && data.ok === false)) redirect(`/settings?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not remove the home."))}`);
  revalidatePath("/settings"); revalidatePath("/project");
  redirect("/settings");
}
