"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// Server actions for the project view. Each is one RPC; the database holds
// the rules and answers {ok, reason}.

export async function bookingAction(projectId: string, action: "bump" | "wait" | "close" | "reopen" | "post" | "remove") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_booking_action", { p_project: projectId, p_action: action });
  revalidatePath(`/project/${projectId}`);
  revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  if (action === "remove") redirect("/project?ok=removed");
  redirect(`/project/${projectId}?ok=${action}`);
}

// A plan's "when" and note. The project id and fields come from the form.
export async function updatePlan(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const window = String(formData.get("target_window") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_plan_update", { p_project: projectId, p_target_window: window || null, p_note: note });
  revalidatePath(`/project/${projectId}`);
  revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=plan`);
}

// Claim another home without ordering anything (create_home_asset under
// the agreement's quota).
export async function addHome(formData: FormData) {
  const address = String(formData.get("address") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || null;
  const next = String(formData.get("next") ?? "/project");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_home_add", { p_address: address, p_name: name });
  revalidatePath("/project");
  if (error || !data?.ok) redirect(`/homes/new?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}&next=${encodeURIComponent(next)}`);
  redirect(`${next}${next.includes("?") ? "&" : "?"}ok=home`);
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

// Invite an existing account to this job as a co-owner, a viewer or the
// contractor (portal_invite_to_project - nobody is seated until they accept).
export async function inviteToProject(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const email = String(formData.get("email") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const seat = String(formData.get("seat") ?? "viewer");
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_invite_to_project", { p_project: projectId, p_email: email, p_phone: phone, p_seat: seat === "peer" ? "resident" : seat, p_note: note });
  revalidatePath(`/project/${projectId}/people`);
  if (error || !data?.ok) redirect(`/project/${projectId}/people?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}/people?ok=${encodeURIComponent(data.name ?? "invited")}`);
}

// Invite a contractor who is not on Green Bergen yet (invite_peer): a link
// they redeem on the portal's join page. The link comes back to the page.
export async function inviteContractor(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const email = String(formData.get("email") ?? "").trim() || null;
  const name = String(formData.get("name") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_peer", { p_kind: "contractor", p_email: email, p_name: name, p_note: note, p_minutes: null, p_quota: 1, p_phone: null });
  if (error || !data?.ok || !data?.token) redirect(`/project/${projectId}/people?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not make the link."))}`);
  redirect(`/project/${projectId}/people?token=${encodeURIComponent(data.token)}&who=${encodeURIComponent(name ?? email ?? "your contractor")}`);
}

// ENDING A JOB, AND UNDOING THAT. Shahar (2026-09-14): "project owners should
// be able to re-open the project / saved by mistake" and "close projects".
//
// The homeowner door could close a booking REQUEST and never the job itself,
// so a project stayed In Progress for ever once the request was withdrawn.
// All three rules are the database's and are old: finishing needs nothing
// left open, cancelling needs a reason and takes the open work with it, and
// reopening is the owner's (migration 122).
export async function closeProject(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_project_close", {
    p_project: projectId, p_note: String(formData.get("note") ?? "").trim() || null,
  });
  revalidatePath(`/project/${projectId}`); revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=finished`);
}

export async function cancelProject(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_project_cancel", {
    p_project: projectId, p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  revalidatePath(`/project/${projectId}`); revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=cancelled`);
}

export async function reopenProject(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_project_reopen", {
    p_project: projectId, p_reason: String(formData.get("reason") ?? "").trim() || null,
  });
  revalidatePath(`/project/${projectId}`); revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=reopened`);
}

// TICK ONE STEP OF THE DIY CHECKLIST (migration 195b).
//
// homeowner_task_close already existed and already carries the rules - it
// checks membership, refuses a task on somebody else's job, and is idempotent
// on a step that is already closed - so this is the same one-RPC shape as
// everything else here rather than a second set of rules in TypeScript.
export async function tickStep(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const actionId = String(formData.get("action_id") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_task_close", { p_project: projectId, p_action_id: actionId });
  revalidatePath(`/project/${projectId}`);
  revalidatePath("/project");
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=step`);
}

// BUILD THE LIST FOR A JOB THAT PREDATES IT. Every DIY job taken from now on
// leaves homeowner_book with its checklist already on it; the ones taken
// before migration 195b have none. Generating on demand is safe because
// homeowner_diy_checklist refuses to run twice - it will not resurrect a step
// somebody has already closed.
export async function buildChecklist(formData: FormData) {
  const projectId = String(formData.get("project") ?? "");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_diy_checklist", { p_project: projectId });
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) redirect(`/project/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect(`/project/${projectId}?ok=checklist`);
}
