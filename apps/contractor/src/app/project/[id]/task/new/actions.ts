"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";

// ADD A TASK TO THIS SITE. Every rule is portal_task_create's - who may add
// work here, which kinds exist, whether this kind carries money, and whether
// a file belongs to the project. This shapes the form and gets out of the way.

function safeBack(raw: FormDataEntryValue | null, fallback: string): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function createTask(projectId: string, formData: FormData) {
  const back = safeBack(formData.get("back"), `/project/${projectId}`);
  const here = (extra: Record<string, string>) => {
    const p = new URLSearchParams({ back, ...extra });
    return `/project/${projectId}/task/new?${p.toString()}`;
  };

  // A target cost is typed by a person, so it arrives with whatever they
  // typed around it - a dollar sign, a comma, a space.
  const raw = String(formData.get("target_cost") ?? "").replace(/[$,\s]/g, "");
  const cost = raw ? Number(raw) : null;
  if (raw && !Number.isFinite(cost)) {
    redirect(here({ error: "A target cost has to be a number." }));
  }

  const files = String(formData.get("file_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_task_create", {
    p_project: projectId,
    p_action: txt(formData.get("action")),
    p_type: txt(formData.get("type")),
    p_delivers: txt(formData.get("delivers")),
    p_description: txt(formData.get("description")),
    p_target_cost: cost,
    p_pay_to_contact: txt(formData.get("pay_to_contact")),
    p_trade: txt(formData.get("trade")),
    p_contract: txt(formData.get("contract")),
    p_assignee: txt(formData.get("assignee")),
    p_priority: txt(formData.get("priority")),
    p_target_date: txt(formData.get("target_date")),
    p_parent: txt(formData.get("parent")),
    p_requires_photo: String(formData.get("requires_photo") ?? "") === "1",
    p_is_gate: String(formData.get("is_gate") ?? "") === "1",
    p_file_ids: files.length > 0 ? files : null,
  });
  if (error) redirect(here({ error: error.message }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That task was not added." }));

  revalidatePath(`/project/${projectId}`);
  revalidatePath("/tasks");
  revalidatePath("/");
  // Onto the task it just made, not back to the list: the next thing anybody
  // does with a new task is give it a date, a holder, or a first note.
  redirect(`/task/${data.id}?back=${encodeURIComponent(back)}&ok=${encodeURIComponent("Task added.")}`);
}
