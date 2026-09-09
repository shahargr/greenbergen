"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";

// Every inbox action, once, for all four apps. Each carries the calling
// app's own inbox path in a hidden `base` field, because the same action
// runs in four apps whose inbox lives at a different route in each - the
// portal's is /my/inbox, everyone else's is /inbox.
//
// Nothing here decides permission. portal_message_seen, portal_message_set,
// portal_message_delete and portal_message_to_task each check that the
// message is yours; this file relays their answer.
function base(formData: FormData): string {
  const s = String(formData.get("base") ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/inbox";
}

const back = (b: string, msg: string, isError = false) =>
  `${b}?${isError ? "error" : "ok"}=${encodeURIComponent(msg)}`;

export async function messageSeen(formData: FormData) {
  const b = base(formData);
  const supabase = await createClient();
  const handled = String(formData.get("handled") ?? "") === "1";
  const { error } = await supabase.rpc("portal_message_seen", {
    p_id: String(formData.get("id") ?? ""), p_handled: handled,
  });
  revalidatePath(b);
  redirect(error ? back(b, error.message, true) : back(b, handled ? "Marked done." : "Marked read."));
}

export async function messageSet(formData: FormData) {
  const b = base(formData);
  const raw = String(formData.get("status") ?? "");
  const status = raw === "dismissed" || raw === "done" || raw === "read" ? raw : "read";
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_message_set", {
    p_id: String(formData.get("id") ?? ""), p_status: status,
  });
  revalidatePath(b);
  redirect(error ? back(b, error.message, true)
    : back(b, status === "dismissed" ? "Archived." : status === "done" ? "Marked complete." : "Marked read."));
}

export async function messageDelete(formData: FormData) {
  const b = base(formData);
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_message_delete", { p_id: String(formData.get("id") ?? "") });
  revalidatePath(b);
  redirect(error ? back(b, error.message, true) : back(b, "Message deleted."));
}

// A message becomes a task and keeps a link back to it. Apps that have a
// task screen pass taskBase (the builder's is /task); the rest come back to
// the inbox, which is where the link now lives anyway.
export async function messageToTask(formData: FormData) {
  const b = base(formData);
  const title = String(formData.get("action") ?? "").trim();
  if (!title) redirect(back(b, "Say what has to be done.", true));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_message_to_task", {
    p_id: String(formData.get("id") ?? ""),
    p_action: title,
    p_due: String(formData.get("due") ?? "").trim() || null,
    p_assignee: null,
  });
  revalidatePath(b);
  if (error) redirect(back(b, error.message, true));
  const id = (data as { action_id?: string } | null)?.action_id;
  const taskBase = String(formData.get("taskBase") ?? "");
  const ok = taskBase.startsWith("/") && !taskBase.startsWith("//") && id;
  redirect(ok ? `${taskBase}/${id}` : back(b, "Task created from the message."));
}

// Send inside the platform - the row IS the delivery, no email, no SMS. Who
// you may reach is decided by shared project membership, and the database
// checks that again rather than trusting this form.
export async function messageSend(formData: FormData) {
  const b = base(formData);
  const body = String(formData.get("body") ?? "").trim();
  const project = String(formData.get("project") ?? "").trim();
  const to = String(formData.get("to") ?? "").trim();
  if (!project || !to) redirect(back(b, "Pick a project and someone to send it to.", true));
  if (!body) redirect(back(b, "Write something first.", true));
  // A photo or a task can ride along (migration 036). Both are checked
  // against the project in the database, which drops a reference that does
  // not belong there rather than sending it on - so passing them through is
  // safe even though this form built them.
  const fileId = String(formData.get("file_id") ?? "").trim() || null;
  const actionId = String(formData.get("action_id") ?? "").trim() || null;
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_portal_message", {
    p_project: project, p_to_contact: to, p_body: body,
    p_file_id: fileId, p_action_id: actionId,
  });
  revalidatePath(b);
  redirect(error ? back(b, error.message, true) : back(b, "Sent. It is in their inbox now."));
}
