"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// Accept or decline an invitation addressed to me (portal_invite_respond
// seats me on accept; the database decides, this only relays).
export async function respondInvite(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const accept = formData.get("accept") === "1";
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_invite_respond", { p_id: id, p_accept: accept });
  revalidatePath("/inbox"); revalidatePath("/project");
  if (error || (data && data.ok === false)) redirect(`/inbox?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/inbox?ok=${accept ? "accepted" : "declined"}`);
}
