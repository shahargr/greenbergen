"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { friendly } from "@/lib/rpc";

// Server actions for the project view. Each is one RPC; the database holds
// the rules and answers {ok, reason}.

export async function bookingAction(projectId: string, action: "bump" | "wait" | "close" | "reopen") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_booking_action", { p_project: projectId, p_action: action });
  revalidatePath(`/project/${projectId}`);
  revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=${action}`);
}

export async function markMilestone(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const key = String(formData.get("key") ?? "");
  const how = String(formData.get("how") ?? "later");
  const reference = String(formData.get("reference") ?? "").trim() || null;
  const fileId = String(formData.get("file_id") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_milestone_mark", { p_project: projectId, p_key: key, p_how: how, p_reference: reference, p_file_id: fileId });
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) {
    redirect(`/project/${projectId}/milestone/${key}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}${data?.milestone_logged ? "&logged=1" : ""}`);
  }
  if (data.code === "CARD_NOT_AVAILABLE") redirect(`/project/${projectId}/milestone/${key}?done=1&card=0`);
  redirect(`/project/${projectId}/milestone/${key}?done=1${data.paid ? "&paid=1" : ""}`);
}

export async function markSeen(projectId: string) {
  const supabase = await createClient();
  await supabase.rpc("homeowner_messages_seen", { p_project: projectId });
}

export async function publishShare(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const quote = String(formData.get("quote") ?? "").trim() || null;
  const hide = formData.get("hide") === "on";
  const afterFileId = String(formData.get("after_file_id") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_share_publish", { p_project: projectId, p_quote: quote, p_hide_address: hide, p_after_file_id: afterFileId });
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) redirect(`/project/${projectId}/share?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}/share?slug=${encodeURIComponent(data.slug)}`);
}

export async function closeTask(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const actionId = String(formData.get("action_id") ?? "");
  const back = String(formData.get("back") ?? `/project/${projectId}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_task_close", { p_project: projectId, p_action_id: actionId });
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) redirect(`${back}${back.includes("?") ? "&" : "?"}error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(back);
}
