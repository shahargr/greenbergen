"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (msg: string, isError = false) =>
  `/my/inbox?${isError ? "error" : "ok"}=${encodeURIComponent(msg)}`;

// Mark one message read, or done with it. Only the person it was addressed
// to may do either; the database enforces that, not this file.
export async function markMessage(messageId: string, handled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_message_seen", { p_id: messageId, p_handled: handled });
  revalidatePath("/my/inbox");
  redirect(error ? back(error.message, true) : back(handled ? "Marked done." : "Marked read."));
}

// Archive (filed away) or complete (dealt with). Both stop it waiting on you.
export async function setMessage(messageId: string, status: "read" | "dismissed" | "done") {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_message_set", { p_id: messageId, p_status: status });
  revalidatePath("/my/inbox");
  redirect(error ? back(error.message, true)
    : back(status === "dismissed" ? "Archived." : status === "done" ? "Marked complete." : "Marked read."));
}

export async function removeMessage(messageId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_message_delete", { p_id: messageId });
  revalidatePath("/my/inbox");
  redirect(error ? back(error.message, true) : back("Message deleted."));
}

// A message becomes a task, and keeps a link to it.
export async function messageToTask(messageId: string, formData: FormData) {
  const supabase = await createClient();
  const title = String(formData.get("action") ?? "").trim();
  if (!title) redirect(back("Say what has to be done.", true));
  const { data, error } = await supabase.rpc("portal_message_to_task", {
    p_id: messageId,
    p_action: title,
    p_due: String(formData.get("due") ?? "").trim() || null,
    p_assignee: null,
  });
  revalidatePath("/my/inbox");
  if (error) redirect(back(error.message, true));
  const id = (data as { action_id?: string } | null)?.action_id;
  redirect(id ? `/my/task/${id}?ok=${encodeURIComponent("Task created from the message.")}` : back("Task created."));
}

// Send a message inside the platform. The row is the delivery — no email, no
// SMS. Who you may reach is decided by shared project membership, and the
// database checks that again rather than trusting this form.
export async function sendMessage(formData: FormData) {
  const supabase = await createClient();
  const body = String(formData.get("body") ?? "").trim();
  const project = String(formData.get("project") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  if (!project || !to) redirect(back("Pick a project and someone to send it to.", true));
  if (!body) redirect(back("Write something to send.", true));

  const { error } = await supabase.rpc("send_portal_message", {
    p_project: project,
    p_to_contact: to,
    p_body: body,
  });
  revalidatePath("/my/inbox");
  redirect(error ? back(error.message, true) : back("Sent. It is in their inbox now."));
}
