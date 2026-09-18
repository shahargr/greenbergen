"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// THE PROCESS EDITOR'S WRITES. Every rule is in the database (migration 176,
// widened by 187): superadmin only, a step must say what it is for, a trade
// must be one we know. This file relays and comes back with a flash.

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

function back(id: string, msg: string, isError: boolean, anchor = "") {
  revalidatePath("/admin/activities");
  revalidatePath(`/admin/activities/${id}`);
  redirect(`/admin/activities/${id}?${isError ? "error" : "saved"}=${encodeURIComponent(msg)}${anchor ? `#${anchor}` : ""}`);
}

// A NEW PROCESS, from the list. It starts with nothing but a name and the
// reason it exists; the steps are the next screen, which is where it opens.
export async function newActivity(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_process_save", {
    p_blueprint: null,
    p_name: s(formData, "name"),
    p_description: s(formData, "description") || null,
    p_domain: s(formData, "domain") || "construction",
    p_is_active: true,
  });
  revalidatePath("/admin/activities");
  if (error || !data?.ok) {
    redirect(`/admin/activities?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Not made.")}`);
  }
  redirect(`/admin/activities/${data.id}?ok=made`);
}

// The process itself - its name, what it is for, its domain, and whether it
// is still one we run.
export async function saveActivity(formData: FormData) {
  const supabase = await createClient();
  const id = s(formData, "id");
  const { data, error } = await supabase.rpc("portal_process_save", {
    p_blueprint: id,
    p_name: s(formData, "name"),
    p_description: s(formData, "description") || null,
    p_domain: s(formData, "domain") || null,
    p_is_active: !!formData.get("is_active"),
  });
  if (error || !data?.ok) back(id, data?.reason ?? error?.message ?? "Not saved.", true);
  back(id, "Saved.", false);
}

// ONE STEP. A blank step id means a new one at the end. The trade picker
// sends "us" for a step that is ours to do - the database reads that, and
// the empty string, as nobody hired.
export async function saveStep(formData: FormData) {
  const supabase = await createClient();
  const id = s(formData, "id");
  const step = s(formData, "step");
  const answers = s(formData, "answers")
    .split(/[,\n]/).map((a) => a.trim()).filter(Boolean);
  const onlyIfKey = s(formData, "only_if_key");
  const onlyIfValue = s(formData, "only_if_value");

  const { data, error } = await supabase.rpc("portal_process_step_save", {
    p_step: step || null,
    p_blueprint: id,
    p_name: s(formData, "name"),
    p_notes: s(formData, "notes") || null,
    p_photo_url: s(formData, "photo_url") || null,
    p_assignee: null,
    p_action_type: s(formData, "action_type") || null,
    p_is_gate: !!formData.get("is_gate"),
    p_necessity: s(formData, "necessity") || null,
    p_asks: s(formData, "asks") || null,
    p_decides: s(formData, "decides") || null,
    p_answers: answers.length ? answers : null,
    p_only_if: onlyIfKey && onlyIfValue ? { [onlyIfKey]: onlyIfValue } : null,
    p_trade: s(formData, "trade"),
    p_hidden_from_owner: !!formData.get("hidden_from_owner"),
  });
  if (error || !data?.ok) back(id, data?.reason ?? error?.message ?? "Not saved.", true, step || "new");
  back(id, step ? "Step saved." : "Step added.", false, data.id ?? "");
}

export async function moveStep(formData: FormData) {
  const supabase = await createClient();
  const id = s(formData, "id");
  const [step, dir] = s(formData, "move").split(":");
  const { data, error } = await supabase.rpc("portal_process_step_move", {
    p_step: step, p_up: dir === "up",
  });
  if (error || !data?.ok) back(id, data?.reason ?? error?.message ?? "It did not move.", true);
  back(id, "Moved.", false, step ?? "");
}

export async function deleteStep(formData: FormData) {
  const supabase = await createClient();
  const id = s(formData, "id");
  const step = s(formData, "delete");
  const { data, error } = await supabase.rpc("portal_process_step_delete", { p_step: step });
  if (error || !data?.ok) back(id, data?.reason ?? error?.message ?? "It did not come off.", true);
  // A step already handed to a live job stays on that job - taking it out of
  // the library does not reach back into work somebody is doing. Say so.
  const open = Number(data.still_open_on_jobs ?? 0);
  back(id, open > 0
    ? `Removed. It is still open on ${open} ${open === 1 ? "job" : "jobs"} already running - those keep it.`
    : "Step removed.", false);
}
