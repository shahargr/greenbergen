"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";

// Post a note on a task, close it, or both - then go back to the list the
// person came from. Every rule lives in the database: add_task_comment
// checks it is your project and not read-only; portal_close_task holds the
// photo gate and records an unlock reason against the task. This relays.

// The return path arrives on the URL, so it is untrusted input: only ever a
// path inside this app, never an absolute URL that could bounce someone off
// the site.
function safeBack(raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/tasks";
}

const to = (path: string, params: Record<string, string>) => {
  const p = new URLSearchParams(params);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
};

export async function saveTask(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = safeBack(formData.get("back"));
  const note = String(formData.get("note") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const complete = String(formData.get("complete") ?? "") === "1";
  const here = (extra: Record<string, string>) => to(`/task/${id}`, { back, ...extra });

  // Evidence uploaded while the note was being written (migration 037). The
  // ids are already real files - the picker uploaded and recorded each one
  // as it was chosen - and the database drops any that do not belong to this
  // task's project rather than linking them.
  const fileIds = String(formData.get("file_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  if (!id) redirect(back);
  // A recording with no text IS a note, so evidence counts as something to post.
  if (!note && fileIds.length === 0 && !complete) {
    redirect(here({ error: "Write an update, attach something, or mark the task complete." }));
  }

  const supabase = await createClient();

  if (note || fileIds.length > 0) {
    const { data, error } = await supabase.rpc("add_task_comment", {
      p_action_id: id, p_body: note || null, p_file_ids: fileIds.length > 0 ? fileIds : null,
    });
    if (error || data?.ok === false) {
      redirect(here({ error: data?.reason ?? error?.message ?? "That update did not save." }));
    }
  }

  if (complete) {
    const { data, error } = await supabase.rpc("portal_close_task", {
      p_action_id: id,
      p_unlock_reason: reason || null,
    });
    if (error) redirect(here({ error: error.message }));
    if (data?.ok === false) {
      // NEEDS_PHOTO and REASON_TOO_SHORT are not failures, they are the
      // database asking for the one thing it needs - so ask for it rather
      // than reporting an error and losing what was typed.
      const asking = data.code === "NEEDS_PHOTO" || data.code === "REASON_TOO_SHORT";
      redirect(here({ error: data.reason ?? "That task did not close.", ...(asking ? { why: "1" } : {}) }));
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath(`/task/${id}`);
  redirect(back);
}
