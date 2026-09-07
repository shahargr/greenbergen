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

// Bring someone onto Green Bergen: a neighbour who will have their own homes
// (kind homeowner - the invitation carries the quota to create one), or a
// contractor. Both are invite_peer, the portal's own machinery; the link
// comes back to this page to copy or share.
export async function invitePerson(formData: FormData) {
  const kind = String(formData.get("kind") ?? "homeowner") === "contractor" ? "contractor" : "homeowner";
  const email = String(formData.get("email") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_peer", {
    p_kind: kind, p_email: email, p_name: name, p_note: note, p_minutes: null, p_quota: 1, p_phone: null,
  });
  if (error || !data?.ok || !data?.token) {
    redirect(`/settings?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not make the link."))}`);
  }
  redirect(`/settings?token=${encodeURIComponent(data.token)}&who=${encodeURIComponent(name ?? email ?? "your neighbor")}&kind=${kind}`);
}
