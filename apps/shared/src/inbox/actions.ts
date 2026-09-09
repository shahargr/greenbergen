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

// The base may already carry a query (the admin door reads the inbox at
// /inbox?door=admin), so the flash joins it rather than starting a second one.
const back = (b: string, msg: string, isError = false) =>
  `${b}${b.includes("?") ? "&" : "?"}${isError ? "error" : "ok"}=${encodeURIComponent(msg)}`;

// The notes on one task, with their evidence signed, for the thread under an
// inbox row. Read on demand - when the row opens - not for every task on the
// page, because twenty-five tasks would be twenty-five reads for a screen
// most people scan and rarely expand.
export type TaskNote = {
  id: string; body: string | null; author: string | null; created_at: string | null;
  files: { file_id: string; path: string; kind: string | null; mime: string | null; name: string | null; url: string | null }[];
};

export async function taskNotes(actionId: string): Promise<TaskNote[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_task_notes", { p_action_id: actionId });
  type Raw = Omit<TaskNote, "files"> & { files?: Omit<TaskNote["files"][number], "url">[] };
  const notes = (Array.isArray(data) ? data : []) as Raw[];
  const paths = [...new Set(notes.flatMap((n) => (n.files ?? []).map((f) => f.path)))];
  const urls: Record<string, string> = {};
  if (paths.length > 0) {
    const { data: signed } = await supabase.storage.from("project-media").createSignedUrls(paths, 3600);
    for (const row of signed ?? []) if (row.path && row.signedUrl) urls[row.path] = row.signedUrl;
  }
  return notes.map((n) => ({ ...n, files: (n.files ?? []).map((f) => ({ ...f, url: urls[f.path] ?? null })) }));
}

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
    : back(b, status === "dismissed" ? "Archived. It is in the Archived folder below." : status === "done" ? "Marked complete." : "Restored."));
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
