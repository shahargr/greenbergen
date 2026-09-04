"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Mark one message read, or done with it. Only the person it was addressed
// to may do either; the database enforces that, not this file.
export async function markMessage(messageId: string, handled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_message_seen", { p_id: messageId, p_handled: handled });
  revalidatePath("/my/inbox");
  redirect(error
    ? `/my/inbox?error=${encodeURIComponent(error.message)}`
    : `/my/inbox?ok=${encodeURIComponent(handled ? "Marked done." : "Marked read.")}`);
}
