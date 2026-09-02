"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Server-side permission matrix (Shahar, 2026-09-01). The UI hides what you
// cannot edit, but THIS is the enforcement - every save recomputes rank and
// assignee and drops disallowed fields.
//   Title / Status / Priority / Target date  -> PM and above (rank >= 50)
//   Desired outcome                          -> above PM (rank >= 60)
//   Notes / Pending on+reason                -> the assignee, or PM and above
//   Dependencies                             -> PM and above
//   Learnings                                -> admin only
//   Assignment                               -> project owner and above (>= 70)
export type TaskPerms = {
  rank: number;
  isAssignee: boolean;
  admin: boolean;
  title: boolean;
  status: boolean;
  outcome: boolean;
  notes: boolean;
  dependencies: boolean;
  learnings: boolean;
  assign: boolean;
  complete: boolean;
};

export async function taskPerms(projectId: string | null, assignedToContact: string | null): Promise<TaskPerms> {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const admin: boolean = me?.is_superadmin ?? false;
  let rank = 0;
  if (projectId) {
    const { data } = await supabase.rpc("my_authority_rank", { p_project_id: projectId });
    rank = (data as number) ?? 0;
  }
  if (admin) rank = 999;
  const isAssignee = !!me?.contact_id && me.contact_id === assignedToContact;
  return {
    rank,
    isAssignee,
    admin,
    title: rank >= 50,
    status: rank >= 50,
    outcome: rank >= 60,
    notes: isAssignee || rank >= 50,
    dependencies: rank >= 50,
    learnings: admin,
    assign: rank >= 70,
    complete: isAssignee || rank >= 50,
  };
}

const OPEN_STATUSES = ["Not Started", "In Progress", "Pending on Others", "Parked"];
const PRIORITIES = ["No Priority", "Low", "Medium", "High"];

export async function saveTask(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id, status")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) redirect("/my?panel=tasks");

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  const updates: Record<string, unknown> = {};

  if (p.title) {
    const v = String(formData.get("title") ?? "").trim();
    if (v) updates.action = v;
  }
  if (p.status) {
    const st = String(formData.get("status") ?? "");
    if (OPEN_STATUSES.includes(st)) updates.status = st;
    const pr = String(formData.get("priority") ?? "");
    if (PRIORITIES.includes(pr)) updates.priority = pr;
    const date = String(formData.get("target_date") ?? "").trim();
    updates.target_date = date || null;
  }
  if (p.outcome) {
    updates.desired_outcome = String(formData.get("desired_outcome") ?? "").trim() || null;
  }
  if (p.notes) {
    updates.notes = String(formData.get("notes") ?? "").trim() || null;
    const effectiveStatus = String(updates.status ?? task.status);
    if (effectiveStatus.includes("Pending")) {
      updates.pending_on = String(formData.get("pending_on") ?? "").trim() || null;
      updates.pending_reason = String(formData.get("pending_reason") ?? "").trim() || null;
    }
  }
  if (p.dependencies) {
    updates.dependencies = String(formData.get("dependencies") ?? "").trim() || null;
  }
  if (p.learnings) {
    updates.learnings = String(formData.get("learnings") ?? "").trim() || null;
  }
  if (p.assign) {
    const to = String(formData.get("assigned_to") ?? "").trim();
    if (to === "") {
      updates.assigned_to_contact_id = null;
    } else {
      // Only a member contact of THIS project is assignable.
      const { data: member } = await supabase
        .from("project_members")
        .select("contact_id")
        .eq("project_id", task.project_id)
        .eq("contact_id", to)
        .maybeSingle();
      if (member) {
        updates.assigned_to_contact_id = to;
        updates.assigned_to_persona_id = null;
      }
    }
  }

  if (Object.keys(updates).length === 0) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Nothing you may edit was changed.")}`);
  }
  updates.last_modified_by = "portal:task";

  const { error } = await supabase.from("actions").update(updates).eq("id", taskId);
  revalidatePath(`/my/task/${taskId}`);
  revalidatePath("/my");
  redirect(error
    ? `/my/task/${taskId}?error=${encodeURIComponent(error.message)}`
    : `/my/task/${taskId}?saved=1`);
}

// Evidence uploads: any number of photos plus an optional voice note, at
// any point in the task's life. Bytes go to project-media Storage; the
// database records each via record_project_file + file_attach (photos as
// the AFTER image, audio as evidence) - rulebook 11f machinery.
export async function uploadEvidence(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || !task.project_id) redirect("/my?panel=tasks");

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  if (!p.notes && !p.complete) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Uploading evidence here is not yours to do.")}`);
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Pick at least one photo or record audio first.")}`);
  }

  let stored = 0;
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : ".m4a")).toLowerCase();
    const path = `${task.project_id}/actions/${taskId}/evidence-${Date.now()}-${stored}${ext}`;
    const bytes = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("project-media")
      .upload(path, bytes, { contentType: file.type || undefined, upsert: true });
    if (upErr) {
      redirect(`/my/task/${taskId}?error=${encodeURIComponent(`Upload failed on ${file.name}: ${upErr.message}`)}`);
    }
    const { data: fileId, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: task.project_id,
      p_path: path,
      p_file_name: file.name || `evidence${ext}`,
      p_mime: file.type || null,
      p_size: file.size,
      p_caption: "Task evidence",
      p_kind: isImage ? "photo" : "audio",
    });
    if (recErr || !fileId) {
      redirect(`/my/task/${taskId}?error=${encodeURIComponent("Uploaded, but could not record a file — try again.")}`);
    }
    await supabase.rpc("file_attach", {
      p_file_id: fileId,
      p_action_id: taskId,
      p_contract_id: null,
      p_role: isImage ? "after" : "evidence",
    });
    stored += 1;
  }

  revalidatePath(`/my/task/${taskId}`);
  redirect(`/my/task/${taskId}?saved=1`);
}

// Flag complete: closes on the strength of ALREADY-ATTACHED evidence, or a
// written reason. Photo-flagged tasks insist on an attached AFTER photo
// (rulebook 11f) - no force-bypass offered.
export async function completeTask(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id, requires_photo_evidence, notes")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) redirect("/my?panel=tasks");

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  if (!p.complete) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Completing this task is not yours to do.")}`);
  }

  const reason = String(formData.get("reason") ?? "").trim();
  const { count: evidenceCount } = await supabase
    .from("file_links")
    .select("id", { count: "exact", head: true })
    .eq("action_id", taskId)
    .in("role", ["after", "evidence", "before", "progress"]);

  if (task.requires_photo_evidence) {
    const { count: afterCount } = await supabase
      .from("file_links")
      .select("id", { count: "exact", head: true })
      .eq("action_id", taskId)
      .eq("role", "after");
    if (!afterCount) {
      redirect(`/my/task/${taskId}?error=${encodeURIComponent("This task requires an AFTER photo — upload it as evidence first.")}`);
    }
  } else if (!evidenceCount && !reason) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Upload evidence first, or write a short reason for closing without it.")}`);
  }

  if (reason) {
    await supabase
      .from("actions")
      .update({
        notes: `${task.notes ? task.notes + "\n\n" : ""}Closed with reason: ${reason}`,
        last_modified_by: "portal:task",
      })
      .eq("id", taskId);
  }

  const { data: me } = await supabase.rpc("me");
  const { error } = await supabase.rpc("close_action", {
    p_action_id: taskId,
    p_force: false,
    p_actor: me?.full_name ?? me?.email ?? "portal user",
    p_final_status: "Completed",
    p_is_final_occurrence: false,
  });
  if (error) {
    const msg = error.message.includes("OPEN_CHILDREN")
      ? "This task has open subtasks - close them first."
      : error.message.includes("MISSING_PHOTO_EVIDENCE")
        ? "This task still needs its BEFORE photo on record."
        : error.message;
    redirect(`/my/task/${taskId}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/my");
  redirect("/my?panel=tasks");
}