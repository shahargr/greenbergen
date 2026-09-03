"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/transcribe";

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
  const chosenStatus = String(formData.get("status") ?? "");
  const closing = p.status && ["Completed", "Cancelled"].includes(chosenStatus);
  if (p.status) {
    if (OPEN_STATUSES.includes(chosenStatus)) updates.status = chosenStatus;
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

  if (Object.keys(updates).length === 0 && !closing) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Nothing you may edit was changed.")}`);
  }
  if (Object.keys(updates).length > 0) {
    updates.last_modified_by = "portal:task";
    const { error } = await supabase.from("actions").update(updates).eq("id", taskId);
    if (error) {
      redirect(`/my/task/${taskId}?error=${encodeURIComponent(error.message)}`);
    }
  }

  // Completed and Cancelled are proper closings, never a bare status write.
  // Completed keeps its evidence gate; Cancelled skips it by design.
  if (closing) {
    if (chosenStatus === "Completed") {
      const { count: evidenceCount } = await supabase
        .from("file_links")
        .select("id", { count: "exact", head: true })
        .eq("action_id", taskId)
        .in("role", ["after", "evidence", "before", "progress"]);
      if (!evidenceCount) {
        redirect(`/my/task/${taskId}?error=${encodeURIComponent("Completing needs evidence or a reason — use the Evidence & completion card below.")}`);
      }
    }
    const { data: me } = await supabase.rpc("me");
    const { error: closeErr } = await supabase.rpc("close_action", {
      p_action_id: taskId,
      p_force: false,
      p_actor: me?.full_name ?? me?.email ?? "portal user",
      p_final_status: chosenStatus,
      p_is_final_occurrence: false,
    });
    if (closeErr) {
      const msg = closeErr.message.includes("OPEN_CHILDREN")
        ? "This task has open subtasks — close them first (they're listed below)."
        : closeErr.message.includes("MISSING_PHOTO_EVIDENCE")
          ? "This task requires BEFORE and AFTER photos on record before completing."
          : closeErr.message;
      redirect(`/my/task/${taskId}?error=${encodeURIComponent(msg)}`);
    }
    revalidatePath("/my");
    redirect("/my?panel=tasks");
  }

  revalidatePath(`/my/task/${taskId}`);
  revalidatePath("/my");
  redirect(`/my/task/${taskId}?saved=1`);
}

// Status moves from the completion card. Completion itself never comes
// through here - the UI routes "Completed" to completeTask and its
// evidence gate; this handles only open-to-open moves, which stay a
// PM-and-above right per the matrix.
export async function setTaskStatus(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) redirect("/my?panel=tasks");

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  const st = String(formData.get("status") ?? "");
  if (!p.status) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Changing status is not yours to do — you can complete the task, with evidence.")}`);
  }
  if (st === "Cancelled") {
    const { data: me } = await supabase.rpc("me");
    const { error: closeErr } = await supabase.rpc("close_action", {
      p_action_id: taskId,
      p_force: false,
      p_actor: me?.full_name ?? me?.email ?? "portal user",
      p_final_status: "Cancelled",
      p_is_final_occurrence: false,
    });
    if (closeErr) {
      const msg = closeErr.message.includes("OPEN_CHILDREN")
        ? "This task has open subtasks — close them first (they're listed below)."
        : closeErr.message;
      redirect(`/my/task/${taskId}?error=${encodeURIComponent(msg)}`);
    }
    revalidatePath("/my");
    redirect("/my?panel=tasks");
  }
  if (!OPEN_STATUSES.includes(st)) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("That is not a status this task can move to.")}`);
  }

  const { error } = await supabase
    .from("actions")
    .update({ status: st, last_modified_by: "portal:task" })
    .eq("id", taskId);
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

  // Record file metadata + link NOW (fast DB ops, so the evidence gate
  // sees them immediately), then upload the bytes AFTER the response - a
  // slow cellular upload can no longer hang the button or hit the
  // function time limit.
  const projectId = task.project_id;
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null; isImage: boolean; fileId: string; name: string }[] = [];
  let stored = 0;
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : ".m4a")).toLowerCase();
    const path = `${projectId}/actions/${taskId}/evidence-${Date.now()}-${stored}${ext}`;
    const bytes = await file.arrayBuffer();
    const { data: fileId } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `evidence${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: "Task evidence",
      p_kind: isImage ? "photo" : "audio",
    });
    if (fileId) {
      await supabase.rpc("file_attach", { p_file_id: fileId, p_action_id: taskId, p_contract_id: null, p_role: isImage ? "after" : "evidence" });
      pending.push({ path, bytes, mime: file.type || null, isImage, fileId: fileId as string, name: file.name || `evidence${ext}` });
    }
    stored += 1;
  }

  after(async () => {
    for (const f of pending) {
      const { error: upErr } = await supabase.storage
        .from("project-media")
        .upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
      if (upErr) continue;
      if (!f.isImage) {
        const t = await transcribeAudio(f.bytes, f.name, f.mime);
        if (!t.ok) continue;
        await supabase.from("files").update({ ai_metadata: { transcript: t.text, transcribed_by: t.provider } }).eq("id", f.fileId);
        const { data: me } = await supabase.rpc("me");
        await supabase.from("task_comments").insert({
          action_id: taskId, author_contact_id: me?.contact_id ?? null,
          author_name: me?.full_name ?? me?.email ?? "Someone",
          body: `🎙 Voice note transcription:\n${t.text}`,
        });
      }
    }
  });

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
      ? "This task has open subtasks — close them first (they're listed below)."
      : error.message.includes("MISSING_PHOTO_EVIDENCE")
        ? "This task still needs its BEFORE photo on record."
        : error.message;
    redirect(`/my/task/${taskId}?error=${encodeURIComponent(msg)}`);
  }

  revalidatePath("/my");
  redirect("/my?panel=tasks");
}
// Comments never require unlocking: anyone who can SEE the task (project
// member) can leave one. RLS on task_comments is the enforcement; the
// author stamp comes from the session, not the form.
export async function addComment(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const body = String(formData.get("body") ?? "").trim();
  if (!body) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Write the comment first.")}`);
  }
  const { data: me } = await supabase.rpc("me");
  const { error } = await supabase.from("task_comments").insert({
    action_id: taskId,
    author_contact_id: me?.contact_id ?? null,
    author_name: me?.full_name ?? me?.email ?? "Someone",
    body,
  });
  revalidatePath(`/my/task/${taskId}`);
  redirect(error
    ? `/my/task/${taskId}?error=${encodeURIComponent(error.message)}`
    : `/my/task/${taskId}?saved=1`);
}

// The person you need is not on the project yet: create the contact and a
// contractor seat in one go, optionally assigning them this task. RLS is
// the boundary (own-contact insert + can_invite_to_project on the seat);
// if the email already belongs to a contact you can see, that contact is
// reused instead of duplicated.
export async function addContractor(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task?.project_id) redirect("/my?panel=tasks");

  const name = String(formData.get("nc_name") ?? "").trim();
  const email = String(formData.get("nc_email") ?? "").trim().toLowerCase() || null;
  const phone = String(formData.get("nc_phone") ?? "").trim() || null;
  if (!name) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("The contractor needs at least a name.")}`);
  }

  const { data: me } = await supabase.rpc("me");

  let contactId: string | null = null;
  if (email) {
    const { data: existing } = await supabase
      .from("contacts").select("id").eq("email_a", email).maybeSingle();
    if (existing) contactId = existing.id;
  }
  if (!contactId) {
    const { data: created, error: cErr } = await supabase
      .from("contacts")
      .insert({
        name, person_name: name, email_a: email, phone,
        owner_user_id: me?.app_user_id ?? null,
        created_by: "portal:task", source: "side_interface",
      })
      .select("id")
      .maybeSingle();
    if (cErr || !created) {
      redirect(`/my/task/${taskId}?error=${encodeURIComponent(cErr?.message ?? "Could not create the contact.")}`);
    }
    contactId = created.id;
  }

  const { data: seat } = await supabase
    .from("project_members")
    .select("id, status")
    .eq("project_id", task.project_id)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (!seat) {
    const { error: mErr } = await supabase.from("project_members").insert({
      project_id: task.project_id,
      contact_id: contactId,
      role: "collaborator",
      project_role: "contractor",
      status: "active",
    });
    if (mErr) {
      redirect(`/my/task/${taskId}?error=${encodeURIComponent(
        mErr.message.includes("row-level security")
          ? "Adding people to this project is not yours to do."
          : mErr.message)}`);
    }
  }

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  if (p.assign) {
    await supabase
      .from("actions")
      .update({ assigned_to_contact_id: contactId, assigned_to_persona_id: null, last_modified_by: "portal:task" })
      .eq("id", taskId);
  }
  revalidatePath(`/my/task/${taskId}`);
  revalidatePath("/my");
  redirect(`/my/task/${taskId}?saved=1`);
}

// Club transactions under a task: a transaction carries one action_id, so a
// task can hold many. Attach sets it, detach clears it. PM+ only (rank >= 50).
async function txPermitted(taskId: string) {
  const supabase = await createClient();
  const { data: task } = await supabase
    .from("actions").select("id, project_id, assigned_to_contact_id").eq("id", taskId).maybeSingle();
  if (!task?.project_id) redirect("/my?panel=tasks");
  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  if (!p.status) redirect(`/my/task/${taskId}?error=${encodeURIComponent("Attaching transactions here is not yours to do.")}`);
  return { supabase, projectId: task.project_id as string };
}

export async function attachTransaction(taskId: string, txId: string) {
  const { supabase, projectId } = await txPermitted(taskId);
  // Scope the write to this project so a transaction can never be pulled in
  // from a project the user is only looking at.
  const { error } = await supabase
    .from("transactions")
    .update({ action_id: taskId, last_modified_by: "portal:task" })
    .eq("id", txId)
    .eq("project_id", projectId);
  revalidatePath(`/my/task/${taskId}`);
  redirect(error ? `/my/task/${taskId}?error=${encodeURIComponent(error.message)}` : `/my/task/${taskId}?saved=1`);
}

export async function detachTransaction(taskId: string, txId: string) {
  const { supabase } = await txPermitted(taskId);
  const { error } = await supabase
    .from("transactions")
    .update({ action_id: null, last_modified_by: "portal:task" })
    .eq("id", txId)
    .eq("action_id", taskId);
  revalidatePath(`/my/task/${taskId}`);
  redirect(error ? `/my/task/${taskId}?error=${encodeURIComponent(error.message)}` : `/my/task/${taskId}?saved=1`);
}
