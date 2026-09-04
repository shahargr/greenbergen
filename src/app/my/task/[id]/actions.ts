"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/transcribe";

// Where a task action returns to: the task page by default, or the homepage
// when the form was submitted from a card there (back="/my"). Only known
// in-app paths are honored (no open redirect).
function backOf(formData: FormData, taskId: string) {
  const back = String(formData.get("back") ?? "");
  if (back === "/my") return "/my";
  // A subtask edited from its parent's page returns to that parent.
  if (/^\/my\/task\/[0-9a-fA-F-]{36}$/.test(back)) return back;
  return `/my/task/${taskId}`;
}
function doneUrl(back: string) {
  return back === "/my" ? `/my?ok=${encodeURIComponent("Saved ✓")}` : `${back}?saved=1`;
}

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
  const back = backOf(formData, taskId);
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
    redirect(`${back}?error=${encodeURIComponent("Nothing you may edit was changed.")}`);
  }
  if (Object.keys(updates).length > 0) {
    updates.last_modified_by = "portal:task";
    const { error } = await supabase.from("actions").update(updates).eq("id", taskId);
    if (error) {
      redirect(`${back}?error=${encodeURIComponent(error.message)}`);
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
      // "No evidence to attach — close anyway": bypasses the generic
      // evidence-or-reason rule and records who forced it. It does NOT
      // bypass the photo-required gate or open subtasks (close_action keeps
      // enforcing both — p_force stays false).
      const forced = formData.get("force_close") === "on";
      if (!evidenceCount && !forced) {
        redirect(`${back}?error=${encodeURIComponent("Completing needs evidence — attach a photo/file, or tick “No evidence to attach — close anyway”.")}`);
      }
      if (!evidenceCount && forced) {
        const { data: who } = await supabase.rpc("me");
        const { data: cur } = await supabase.from("actions").select("notes").eq("id", taskId).maybeSingle();
        await supabase.from("actions").update({
          notes: `${cur?.notes ? cur.notes + "\n\n" : ""}[${new Date().toISOString().slice(0, 10)}] Closed without evidence — forced by ${who?.full_name ?? who?.email ?? "portal user"}.`,
          last_modified_by: "portal:task",
        }).eq("id", taskId);
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
      redirect(`${back}?error=${encodeURIComponent(msg)}`);
    }
    revalidatePath("/my");
    // Close-and-chain: land on the follow-up if one was named.
    const nextId = await spawnFollowUp(supabase, taskId, String(formData.get("follow_up") ?? ""));
    redirect(nextId ? `/my/task/${nextId}?saved=1` : "/my?panel=tasks");
  }

  revalidatePath(`/my/task/${taskId}`);
  revalidatePath("/my");
  redirect(doneUrl(back));
}

// Status moves from the completion card. Completion itself never comes
// through here - the UI routes "Completed" to completeTask and its
// evidence gate; this handles only open-to-open moves, which stay a
// PM-and-above right per the matrix.
export async function setTaskStatus(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const back = backOf(formData, taskId);
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task) redirect("/my?panel=tasks");

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  const st = String(formData.get("status") ?? "");
  if (!p.status) {
    redirect(`${back}?error=${encodeURIComponent("Changing status is not yours to do — you can complete the task, with evidence.")}`);
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
      redirect(`${back}?error=${encodeURIComponent(msg)}`);
    }
    revalidatePath("/my");
    // Close-and-chain: a cancelled task can still hand off to a follow-up.
    const nextId = await spawnFollowUp(supabase, taskId, String(formData.get("follow_up") ?? ""));
    redirect(nextId ? `/my/task/${nextId}?saved=1` : "/my?panel=tasks");
  }
  if (!OPEN_STATUSES.includes(st)) {
    redirect(`${back}?error=${encodeURIComponent("That is not a status this task can move to.")}`);
  }

  // A comment travels with the move. It is REQUIRED for Pending on Others
  // (the database refuses a pending status without a reason) and becomes
  // both the pending reason and a comment on the task.
  const comment = String(formData.get("comment") ?? "").trim();
  const isPending = /pending/i.test(st);
  if (isPending && !comment) {
    redirect(`${back}?error=${encodeURIComponent("Pending on Others needs a comment: who you are waiting on, and for what.")}`);
  }
  const updates: Record<string, unknown> = { status: st, last_modified_by: "portal:task" };
  if (isPending) {
    updates.pending_reason = comment;
    const who = String(formData.get("pending_on") ?? "").trim();
    if (who) updates.pending_on = who;
  }
  const { error } = await supabase.from("actions").update(updates).eq("id", taskId);
  if (!error && comment) {
    const { data: me } = await supabase.rpc("me");
    await supabase.from("task_comments").insert({
      action_id: taskId, author_contact_id: me?.contact_id ?? null,
      author_name: me?.full_name ?? me?.email ?? "Someone",
      body: `Moved to ${st}: ${comment}`,
    });
  }
  revalidatePath(`/my/task/${taskId}`);
  revalidatePath("/my");
  redirect(error
    ? `${back}?error=${encodeURIComponent(error.message)}`
    : doneUrl(back));
}

// Evidence uploads: any number of photos plus an optional voice note, at
// any point in the task's life. Bytes go to project-media Storage; the
// database records each via record_project_file + file_attach (photos as
// the AFTER image, audio as evidence) - rulebook 11f machinery.
export async function uploadEvidence(taskId: string, formData: FormData) {
  const supabase = await createClient();
  const back = backOf(formData, taskId);
  const { data: task } = await supabase
    .from("actions")
    .select("id, project_id, assigned_to_contact_id")
    .eq("id", taskId)
    .maybeSingle();
  if (!task || !task.project_id) redirect("/my?panel=tasks");

  const p = await taskPerms(task.project_id, task.assigned_to_contact_id);
  if (!p.notes && !p.complete) {
    redirect(`${back}?error=${encodeURIComponent("Uploading evidence here is not yours to do.")}`);
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`${back}?error=${encodeURIComponent("Pick at least one photo or record audio first.")}`);
  }

  // Record file metadata + link NOW (fast DB ops, so the evidence gate
  // sees them immediately), then upload the bytes AFTER the response - a
  // slow cellular upload can no longer hang the button or hit the
  // function time limit.
  const projectId = task.project_id;
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null; isImage: boolean; fileId: string; name: string }[] = [];
  let stored = 0;
  const failures: string[] = [];
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isAudio = file.type.startsWith("audio/") || /\.(m4a|webm|mp3|wav|ogg)$/i.test(file.name);
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const kind = isImage ? "photo" : isAudio ? "audio" : isPdf ? "document" : "other";
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : isAudio ? ".m4a" : ".bin")).toLowerCase();
    const path = `${projectId}/actions/${taskId}/evidence-${Date.now()}-${stored}${ext}`;
    const bytes = await file.arrayBuffer();
    // A refusal here (plan, quota, permission) must reach the user - a
    // silent skip used to leave "Saved ✓" on screen with nothing recorded.
    const { data: fileId, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `evidence${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: "Task evidence",
      p_kind: kind,
    });
    if (recErr || !fileId) {
      failures.push(`${file.name || "file"}: ${recErr?.message ?? "not recorded"}`);
      stored += 1;
      continue;
    }
    const { error: linkErr } = await supabase.rpc("file_attach", {
      p_file_id: fileId, p_action_id: taskId, p_contract_id: null, p_role: isImage ? "after" : "evidence",
    });
    if (linkErr) failures.push(`${file.name || "file"}: recorded but not linked — ${linkErr.message}`);
    pending.push({ path, bytes, mime: file.type || null, isImage: !isAudio, fileId: fileId as string, name: file.name || `evidence${ext}` });
    stored += 1;
  }
  if (failures.length > 0 && pending.length === 0) {
    redirect(`${back}?error=${encodeURIComponent(`Nothing was attached. ${failures.join(" · ")}`)}`);
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
  revalidatePath("/my");
  if (failures.length > 0) {
    redirect(`${back}?error=${encodeURIComponent(`${pending.length} attached, ${failures.length} refused: ${failures.join(" · ")}`)}`);
  }
  redirect(doneUrl(back));
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
  // Close-and-chain: the follow-up is a sibling that follows this task, so
  // the close above already succeeded before it is created; land on it.
  const nextId = await spawnFollowUp(supabase, taskId, String(formData.get("follow_up") ?? ""));
  redirect(nextId ? `/my/task/${nextId}?saved=1` : "/my?panel=tasks");
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

// Create a transaction and club it under this task in one step - the
// alternative to searching for one that already exists. Same permission
// gate as attaching; the row is written as the signed-in user so RLS on
// transactions still decides.
export async function createTaskTransaction(taskId: string, formData: FormData) {
  const { supabase, projectId } = await txPermitted(taskId);
  const back = `/my/task/${taskId}`;
  const paidTo = String(formData.get("paid_to") ?? "").trim();
  const amount = Number(String(formData.get("amount") ?? "").replace(/[$,\s]/g, ""));
  if (!paidTo) redirect(`${back}?error=${encodeURIComponent("Who was paid?")}`);
  if (!Number.isFinite(amount) || amount <= 0) redirect(`${back}?error=${encodeURIComponent("Enter the amount.")}`);

  const methodId = String(formData.get("method") ?? "").trim() || null;
  const [{ data: methodRow }, { data: payeeRows }] = await Promise.all([
    methodId
      ? supabase.from("payment_methods").select("name").eq("id", methodId).maybeSingle()
      : Promise.resolve({ data: null as { name: string } | null }),
    supabase.from("project_members").select("contact_id, contacts(name, person_name)")
      .eq("project_id", projectId).eq("status", "active").not("contact_id", "is", null),
  ]);
  // The row's contact is the PAYEE. Match "Paid to" against people on this
  // project; no match simply leaves it unlinked rather than guessing.
  const want = paidTo.toLowerCase();
  const payeeId = (((payeeRows ?? []) as unknown as { contact_id: string; contacts: { name: string | null; person_name: string | null } | null }[]))
    .find((m) => [m.contacts?.person_name, m.contacts?.name].some((n) => (n ?? "").trim().toLowerCase() === want))
    ?.contact_id ?? null;

  const status = String(formData.get("status") ?? "paid").trim() || "paid";
  const { error } = await supabase.from("transactions").insert({
    description: `Payment to ${paidTo}`,
    amount,
    direction: "out",
    status,
    paid_on: String(formData.get("paid_on") ?? "").trim() || new Date().toISOString().slice(0, 10),
    paid_via: methodRow?.name ?? null,
    payment_method_id: methodId,
    paid_from_account: String(formData.get("paid_from") ?? "").trim() || null,
    project_id: projectId,
    action_id: taskId,
    contractor_id: payeeId,
    notes: String(formData.get("notes") ?? "").trim() || null,
    created_by: "portal:task",
    last_modified_by: "portal:task",
  });
  revalidatePath(back);
  redirect(error
    ? `${back}?error=${encodeURIComponent(error.message.includes("row-level security") ? "Logging a transaction on this project is not yours to do." : error.message)}`
    : `${back}?saved=1`);
}

// Close-and-chain: when a task closes with a follow-up named, the next task
// is created as a SIBLING that follows it (follows_action_id), never as a
// child - a child would have blocked the close under the OPEN_CHILDREN
// guard. Carries over project, assignee, priority and domain. Returns the
// new id, or null when there was nothing to spawn or the insert failed
// (a failed follow-up must never undo a close that already happened).
async function spawnFollowUp(
  supabase: Awaited<ReturnType<typeof createClient>>,
  closedTaskId: string,
  title: string | null,
): Promise<string | null> {
  const clean = (title ?? "").trim();
  if (!clean) return null;
  const { data: src } = await supabase
    .from("actions")
    .select("project_id, assigned_to_contact_id, assigned_to_persona_id, priority, domain, target_date")
    .eq("id", closedTaskId)
    .maybeSingle();
  if (!src) return null;
  const { data: me } = await supabase.rpc("me");
  const { data: row } = await supabase
    .from("actions")
    .insert({
      action: clean,
      status: "Not Started",
      priority: src.priority ?? "No Priority",
      domain: src.domain ?? "construction",
      project_id: src.project_id,
      assigned_to_contact_id: src.assigned_to_contact_id,
      assigned_to_persona_id: src.assigned_to_persona_id,
      follows_action_id: closedTaskId,
      created_by: me?.full_name ?? me?.email ?? "portal user",
      source: "manual",
      notes: `Follow-up chained from the closed task ${closedTaskId}.`,
      last_modified_by: "portal:follow-up",
    })
    .select("id")
    .maybeSingle();
  return (row?.id as string | undefined) ?? null;
}

// The owner (or a superadmin) answers a deletion-approval gate. Approve
// trashes the project and completes the gate; decline cancels the gate.
async function deletionGate(taskId: string) {
  const supabase = await createClient();
  const { data: task } = await supabase.from("actions").select("id, action, project_id, status").eq("id", taskId).maybeSingle();
  if (!task || !task.project_id || !String(task.action ?? "").startsWith("Approve deletion — ")) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("This is not a deletion request.")}`);
  }
  const [{ data: project }, { data: me }] = await Promise.all([
    supabase.from("projects").select("id, project_name, owner_user_id").eq("id", task.project_id).maybeSingle(),
    supabase.rpc("me"),
  ]);
  if (!project || !me?.app_user_id) redirect(`/my/task/${taskId}?error=${encodeURIComponent("Please sign in first.")}`);
  if (me.app_user_id !== project.owner_user_id && !me.is_superadmin) {
    redirect(`/my/task/${taskId}?error=${encodeURIComponent("Only the project owner can approve or decline this.")}`);
  }
  return { supabase, task, project, actor: (me.full_name ?? me.email ?? "portal user") as string };
}

export async function approveDeletion(taskId: string) {
  const { supabase, task, project, actor } = await deletionGate(taskId);
  const { data, error } = await supabase.rpc("trash_own_project", { p_project_id: project.id });
  if (error || !data?.ok) redirect(`/my/task/${taskId}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not move the project to the recycle bin.")}`);
  await supabase.rpc("close_action", { p_action_id: task.id, p_force: true, p_actor: actor, p_final_status: "Completed", p_is_final_occurrence: false });
  revalidatePath("/my");
  revalidatePath("/my/settings");
  redirect(`/my?ok=${encodeURIComponent(`"${project.project_name}" moved to the recycle bin — restore within ${data.days} days from Settings.`)}`);
}

export async function declineDeletion(taskId: string) {
  const { supabase, task, project, actor } = await deletionGate(taskId);
  await supabase.rpc("close_action", { p_action_id: task.id, p_force: true, p_actor: actor, p_final_status: "Cancelled", p_is_final_occurrence: false });
  revalidatePath(`/my/project/${project.id}`);
  redirect(`/my/project/${project.id}?tab=admin&ok=${encodeURIComponent("Deletion declined — the project stays.")}`);
}
