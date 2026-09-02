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
export async function cancelInvitation(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/my/invite");
  const { error } = await supabase
    .from("app_invitations")
    .update({ status: "revoked" })
    .eq("id", id)
    .eq("status", "pending");
  revalidatePath("/my/invite");
  redirect(error ? `/my/invite?error=${encodeURIComponent(error.message)}` : "/my/invite");
}
