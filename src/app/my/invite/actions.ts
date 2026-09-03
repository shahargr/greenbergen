"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sendMail } from "@/lib/mailer";

// Sends an invitation email through the app (Mailtrap). Only a signed-in
// user can call this, and the message carries their name - never a spoofed
// sender.
export async function emailInvitation(to: string, messageText: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Please sign in first." };
  if (!to.trim()) return { error: "No recipient email on this invitation." };

  const res = await sendMail(
    to.trim(),
    "An invitation to Green Bergen",
    messageText,
  );
  return res.ok ? { ok: true } : { error: res.error };
}

// Revoke a pending invitation of your own - the link stops working
// immediately (redeem checks status). RLS already scopes updates to the
// inviter (or an admin).
// Only a PENDING invitation can be cancelled - an accepted one is already a
// seat and is untouched here. The page's project context rides along so
// the list you were looking at is still there afterwards.
export async function cancelInvitation(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const project = String(formData.get("project") ?? "").trim();
  const base = project ? `/my/invite?project=${project}&` : "/my/invite?";
  if (!id) redirect(base.replace(/[?&]$/, ""));
  const { error } = await supabase
    .from("app_invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("status", "pending");
  revalidatePath("/my/invite");
  redirect(error ? `${base}error=${encodeURIComponent(error.message)}` : `${base}ok=${encodeURIComponent("Invitation cancelled.")}`);
}

// Permanently remove all of the caller's revoked invitations.
export async function clearRevokedInvitations(formData: FormData) {
  const supabase = await createClient();
  const project = String(formData.get("project") ?? "").trim();
  const base = project ? `/my/invite?project=${project}&` : "/my/invite?";
  const { data, error } = await supabase.rpc("clear_revoked_invitations");
  revalidatePath("/my/invite");
  redirect(error || !data?.ok
    ? `${base}status=revoked&error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not clear.")}`
    : `${base}ok=${encodeURIComponent(`Cleared ${data.cleared} revoked invitation${data.cleared === 1 ? "" : "s"} ✓`)}`);
}

// Invite an existing account to a project by email or phone. The RPC finds
// the account (or reports "wrong user information provided"), seats nobody
// yet — the invitee accepts or declines on their next login.
export async function inviteToProject(formData: FormData) {
  const supabase = await createClient();
  const project = String(formData.get("project") ?? "");
  const contact = String(formData.get("contact") ?? "").trim();
  const seat = String(formData.get("seat") ?? "viewer");
  const note = String(formData.get("note") ?? "").trim() || null;
  // Optional return page (the project page invites inline); only portal
  // paths are honored.
  const backTo = String(formData.get("back") ?? "");
  const back = /^\/my\/[a-z0-9/_-]*$/i.test(backTo) ? `${backTo}?` : project ? `/my/invite?project=${project}&` : "/my/invite?";
  const isEmail = contact.includes("@");
  const { data, error } = await supabase.rpc("portal_invite_to_project", {
    p_project: project || null, p_email: isEmail ? contact : null, p_phone: isEmail ? null : contact,
    p_seat: seat, p_note: note,
  });
  revalidatePath("/my/invite");
  if (backTo) revalidatePath(backTo);
  redirect(error || !data?.ok
    ? `${back}error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not send the invitation.")}`
    : `${back}ok=${encodeURIComponent(`Invitation sent to ${data.name} ✓`)}`);
}
