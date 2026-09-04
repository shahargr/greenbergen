"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { PROJECT_STAGES } from "@/lib/stages";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Edit a person's contact record (name / phone / email / trade / notes) from
// the People table or Settings → Contacts. The permission gate lives in the
// portal_update_contact RPC (superadmin, your own record, or owner/manager on
// a shared project). Returns to `back`: Settings or a project page only.
export async function updateContact(formData: FormData) {
  const supabase = await createClient();
  const contactId = String(formData.get("contact") ?? "");
  const rawBack = String(formData.get("back") ?? "/my/settings");
  const back = rawBack === "/my/settings" || /^\/my\/project\/[0-9a-f-]{36}$/.test(rawBack) ? rawBack : "/my/settings";
  if (!contactId) redirect(`${back}?error=${encodeURIComponent("Missing contact.")}`);
  const { data, error } = await supabase.rpc("portal_update_contact", {
    p_contact: contactId,
    p_name: String(formData.get("name") ?? "").trim() || null,
    p_phone: formData.has("phone") ? String(formData.get("phone") ?? "").trim() : null,
    p_email: formData.has("email") ? String(formData.get("email") ?? "").trim() : null,
    p_trade: String(formData.get("trade") ?? "").trim() || null,
    p_notes: formData.has("notes") ? String(formData.get("notes") ?? "").trim() : null,
  });
  revalidatePath(back);
  revalidatePath("/my");
  if (error || !data?.ok) {
    redirect(`${back}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not save the contact.")}`);
  }
  redirect(`${back}?saved=1`);
}

// Server-side permission matrix for projects, in the spirit of the task
// matrix. The UI hides what you cannot edit; THIS drops disallowed fields
// on every save, and the projects RLS update policy is the final backstop.
//   Name / Notes            -> PM and above (rank >= 50)
//   Status / Address        -> project owner and above (rank >= 70)
//   Purchase & sale figures -> shown to owners, edited by admin only
export type ProjectPerms = {
  rank: number;
  admin: boolean;
  name: boolean;
  notes: boolean;
  status: boolean;
  address: boolean;
  financials: boolean;
};

export async function projectPerms(projectId: string): Promise<ProjectPerms> {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const admin: boolean = me?.is_superadmin ?? false;
  let rank = 0;
  const { data } = await supabase.rpc("my_authority_rank", { p_project_id: projectId });
  rank = (data as number) ?? 0;
  if (admin) rank = 999;
  return {
    rank,
    admin,
    name: rank >= 50,
    notes: rank >= 50,
    status: rank >= 70,
    address: rank >= 70,
    financials: admin,
  };
}

const PROJECT_STATUSES = ["In Progress", "Closed - Completed", "Closed - Incomplete"];

export async function saveProject(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const p = await projectPerms(projectId);
  const updates: Record<string, unknown> = {};

  if (p.name) {
    const v = String(formData.get("name") ?? "").trim();
    if (v) updates.project_name = v;
  }
  if (p.notes) {
    updates.notes = String(formData.get("notes") ?? "").trim() || null;
  }
  if (p.status) {
    const st = String(formData.get("status") ?? "");
    if (PROJECT_STATUSES.includes(st)) updates.status = st;
    // Stage is the definition-panel field; the same authority governs both.
    const sg = String(formData.get("stage") ?? "");
    if (PROJECT_STAGES.includes(sg)) updates.stage = sg;
  }
  if (p.address) {
    const v = String(formData.get("address") ?? "").trim();
    updates.address = v || null;
  }

  if (Object.keys(updates).length === 0) {
    redirect(`/my/project/${projectId}?error=${encodeURIComponent("Nothing you may edit was changed.")}`);
  }
  updates.last_modified_by = "portal:project";

  const { error } = await supabase.from("projects").update(updates).eq("id", projectId);
  revalidatePath(`/my/project/${projectId}`);
  revalidatePath("/my");
  redirect(error
    ? `/my/project/${projectId}?error=${encodeURIComponent(error.message)}`
    : `/my/project/${projectId}?saved=1`);
}

// Structured configurator answers - one row per field, upserted.
export async function saveConfigValues(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const who = me?.full_name ?? me?.email ?? "portal user";

  // Each field posts its own label; fall back to the key only if it did not.
  const labels: Record<string, string> = {};
  for (const [key, raw] of formData.entries()) {
    if (key.startsWith("label__") && typeof raw === "string") labels[key.slice(7)] = raw;
  }
  const rows: { project_id: string; key: string; label: string; value: string | null; updated_by: string }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string" || key.startsWith("label__")) continue;
    rows.push({
      project_id: projectId, key,
      label: labels[key] ?? key.replace(/_/g, " "),
      value: raw.trim() || null, updated_by: who,
    });
  }
  const { error } = await supabase
    .from("project_config_values")
    .upsert(rows, { onConflict: "project_id,key" });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error
    ? `/my/project/${projectId}?error=${encodeURIComponent(error.message)}`
    : `/my/project/${projectId}?saved=1`);
}

// Deleting moves the project to the recycle bin (trash_own_project keeps
// the same guards: owner rank, no children, no contracts, no money).
// Restore any time inside the retention window; purge is nightly.
// Deletion is a two-step: asking creates an approval GATE assigned to the
// project owner; approving it (on the task page) is what moves the project
// to the recycle bin. Nothing is trashed here.
export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}?tab=admin`;
  const [{ data: project }, { data: me }] = await Promise.all([
    supabase.from("projects").select("id, project_name, owner_user_id").eq("id", projectId).maybeSingle(),
    supabase.rpc("me"),
  ]);
  if (!project) redirect("/my");
  if (!me?.app_user_id) redirect(`${back}&error=${encodeURIComponent("Please sign in first.")}`);
  const { data: owner } = project.owner_user_id
    ? await supabase.from("app_users").select("id, contact_id, full_name, email").eq("id", project.owner_user_id).maybeSingle()
    : { data: null };
  const title = `Approve deletion — ${project.project_name}`;
  const { data: existing } = await supabase.from("actions").select("id").eq("project_id", projectId).eq("action", title)
    .not("status", "in", "(\"Completed\",\"Cancelled\",\"Force Cancelled\")").maybeSingle();
  if (existing) redirect(`/my/task/${existing.id}?error=${encodeURIComponent("A deletion request is already waiting for the owner's approval.")}`);
  const requester = me.full_name ?? me.email ?? "someone";
  const { data: row, error } = await supabase.from("actions").insert({
    project_id: projectId,
    action: title,
    status: "Not Started",
    priority: "High",
    domain: "construction",
    is_gate: true,
    assigned_to_contact_id: owner?.contact_id ?? null,
    assigned_by_contact_id: me.contact_id ?? null,
    desired_outcome: "The project owner approves or declines moving this project to the recycle bin.",
    notes: `DELETION REQUEST by ${requester} on ${new Date().toISOString().slice(0, 10)}. Approving moves "${project.project_name}" - tasks, media and all - to the recycle bin (restorable for the retention window). Declining leaves everything as it is. Only the project owner${owner ? ` (${owner.full_name ?? owner.email})` : ""} or a superadmin can approve.`,
    created_by: requester,
    source: "manual",
  }).select("id").maybeSingle();
  if (error || !row) redirect(`${back}&error=${encodeURIComponent(error?.message ?? "Could not create the approval request.")}`);
  revalidatePath(`/my/project/${projectId}`);
  revalidatePath("/my");
  const isOwner = me.app_user_id === project.owner_user_id;
  redirect(isOwner
    ? `/my/task/${row.id}`
    : `${back}&ok=${encodeURIComponent(`Deletion request sent to ${owner?.full_name ?? owner?.email ?? "the owner"} for approval.`)}`);
}

export async function restoreProject(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("restore_trashed_project", { p_project_id: projectId });
  if (error || !data?.ok) {
    redirect(`/my/settings?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not restore.")}`);
  }
  // Stay on Settings: the row leaves the recycle bin and the project is back home.
  revalidatePath("/my");
  revalidatePath("/my/settings");
  redirect("/my/settings");
}

// Empty-now path: storage bytes first, then the guarded hard delete.
export async function deleteProjectNow(projectId: string) {
  const supabase = await createClient();
  const { data: fileRows } = await supabase
    .from("files")
    .select("bucket, path")
    .eq("project_id", projectId);
  const byBucket = new Map<string, string[]>();
  for (const f of (fileRows ?? []) as { bucket: string; path: string }[]) {
    byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path]);
  }
  const { data, error } = await supabase.rpc("delete_own_project", { p_project_id: projectId });
  if (error || !data?.ok) {
    redirect(`/my/settings?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not delete.")}`);
  }
  for (const [bucket, paths] of byBucket) {
    await supabase.storage.from(bucket).remove(paths);
  }
  // Stay on Settings: the row simply disappears from the recycle bin.
  revalidatePath("/my");
  revalidatePath("/my/settings");
  redirect("/my/settings");
}

// A configuration checklist item: attach a photo (uploaded after the
// response) and mark it done, or toggle done directly. Config items are
// tasks (scope_milestone=Configuration); RLS on actions is the boundary.
export async function configAttach(projectId: string, taskId: string, formData: FormData) {
  const supabase = await createClient();
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);

  if (files.length) {
    after(async () => {
      let i = 0;
      for (const file of files) {
        const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
        const path = `${projectId}/config/${taskId}/${Date.now()}-${i}${ext}`;
        const bytes = await file.arrayBuffer();
        const { error: upErr } = await supabase.storage
          .from("project-media")
          .upload(path, bytes, { contentType: file.type || undefined, upsert: true });
        if (!upErr) {
          const { data: fileId } = await supabase.rpc("record_project_file", {
            p_project_id: projectId, p_path: path, p_file_name: file.name || `config${ext}`,
            p_mime: file.type || null, p_size: file.size, p_caption: "Configuration photo", p_kind: "photo",
          });
          if (fileId) {
            await supabase.rpc("file_attach", { p_file_id: fileId, p_action_id: taskId, p_contract_id: null, p_role: "reference" });
          }
        }
        i += 1;
      }
    });
  }
  await supabase.from("actions").update({ status: "Completed", completed_on: new Date().toISOString(), last_modified_by: "portal:config" }).eq("id", taskId);
  revalidatePath(`/my/project/${projectId}`);
  redirect(`/my/project/${projectId}?saved=1`);
}

export async function configToggle(projectId: string, taskId: string, done: boolean) {
  const supabase = await createClient();
  await supabase.from("actions")
    .update({ status: done ? "Completed" : "Not Started", completed_on: done ? new Date().toISOString() : null, last_modified_by: "portal:config" })
    .eq("id", taskId);
  revalidatePath(`/my/project/${projectId}`);
  redirect(`/my/project/${projectId}?saved=1`);
}

// Manage tab: who is on site on a given day. Replaces that day's roster.
export async function setSiteRoster(formData: FormData) {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const date = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const contacts = formData.getAll("contact").map(String).filter(Boolean);
  const back = `/my/project/${projectId}?tab=visit&date=${date}`;
  const { data, error } = await supabase.rpc("portal_site_roster_set", { p_project: projectId, p_date: date, p_contacts: contacts });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error || !data?.ok
    ? `${back}&error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not save the roster.")}`
    : `${back}&ok=${encodeURIComponent(`${data.on_site} on site ${date === new Date().toISOString().slice(0, 10) ? "today" : date} ✓`)}`);
}

// Site visit tab: log a visit as a completed "Site visit log" task on the
// project, with its evidence attached (role progress). Metadata now, bytes
// after the response, same pattern as task evidence.
export async function logSiteVisit(formData: FormData) {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const date = String(formData.get("date") ?? "").trim() || new Date().toISOString().slice(0, 10);
  const headline = String(formData.get("headline") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const back = `/my/project/${projectId}?tab=visit`;
  if (!projectId) redirect("/my");
  if (!headline && !note) redirect(`${back}&error=${encodeURIComponent("Write what you saw - a headline or a note.")}`);
  const dow = new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" });
  const { data: me } = await supabase.rpc("me");
  const { data: row, error } = await supabase.from("actions").insert({
    project_id: projectId,
    action: `Site visit log - ${date} (${dow})${headline ? ` - ${headline}` : ""}`,
    status: "Completed",
    completed_on: date,
    domain: "construction",
    notes: note || null,
    priority: "No Priority",
    created_by: me?.full_name ?? me?.email ?? "portal:site-visit",
    source: "manual",
  }).select("id").maybeSingle();
  if (error || !row) redirect(`${back}&error=${encodeURIComponent(error?.message ?? "Could not log the visit.")}`);
  const visitId = row.id as string;

  const files = [...formData.getAll("files"), ...formData.getAll("videos"), ...formData.getAll("docs")]
    .filter((f): f is File => f instanceof File && f.size > 0);
  const failures: string[] = [];
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null }[] = [];
  const recorded: string[] = [];
  let i = 0;
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const kind = isImage ? "photo" : isVideo ? "video" : isAudio ? "audio" : isPdf ? "document" : "other";
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = `${projectId}/actions/${visitId}/visit-${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { data: fileId, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `visit${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: `Site visit ${date}`, p_kind: kind,
    });
    if (recErr || !fileId) { failures.push(`${file.name}: ${recErr?.message ?? "not recorded"}`); i += 1; continue; }
    await supabase.rpc("file_attach", { p_file_id: fileId, p_action_id: visitId, p_contract_id: null, p_role: "progress" });
    recorded.push(fileId as string);
    pending.push({ path, bytes, mime: file.type || null });
    i += 1;
  }
  after(async () => {
    for (const f of pending) {
      await supabase.storage.from("project-media").upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
    }
  });

  // What you saw, turned into work: one open task per row, hanging under the
  // visit log so the note that prompted it is always one click away.
  const whats = formData.getAll("task_what").map((v) => String(v).trim());
  const whos = formData.getAll("task_who").map((v) => String(v).trim());
  const rowIds = formData.getAll("task_row").map((v) => String(v));
  const attachRows = new Set(formData.getAll("task_attach").map((v) => String(v)));
  let made = 0;
  for (let k = 0; k < whats.length; k += 1) {
    const what = whats[k];
    if (!what) continue;
    const { data: t, error: tErr } = await supabase.from("actions").insert({
      action: what,
      domain: "construction",
      status: "Not Started",
      priority: "Medium",
      project_id: projectId,
      parent_action_id: visitId,
      assigned_to_contact_id: whos[k] || null,
      assigned_by_contact_id: me?.contact_id ?? null,
      notes: `From the site visit on ${date}${headline ? ` — ${headline}` : ""}.`,
      source: "manual",
      created_by: "portal:site-visit",
      last_modified_by: "portal:site-visit",
    }).select("id").maybeSingle();
    if (tErr || !t) { failures.push(`task "${what}": ${tErr?.message ?? "not created"}`); continue; }
    made += 1;
    // The visit's photos ride along when the row asked for them.
    if (attachRows.has(rowIds[k] ?? String(k))) {
      for (const fid of recorded) {
        await supabase.rpc("file_attach", { p_file_id: fid, p_action_id: t.id, p_contract_id: null, p_role: "reference" });
      }
    }
  }

  revalidatePath(`/my/project/${projectId}`);
  const madeNote = made ? ` · ${made} task${made === 1 ? "" : "s"} created` : "";
  if (failures.length) redirect(`${back}&error=${encodeURIComponent(`Visit logged${madeNote}; ${failures.length} file(s) refused: ${failures.join(" · ")}`)}`);
  redirect(`${back}&ok=${encodeURIComponent(`Visit logged${pending.length ? ` with ${pending.length} file${pending.length === 1 ? "" : "s"}` : ""}${madeNote} ✓`)}`);
}

// ---------------------------------------------------------------------------
// Bids needed: the list of trades, permits and purchases a project has to line
// up. Seeded from the trade blueprint, then edited by hand (v185 / v186).

const backSetup = (projectId: string, msg: string, isError = false) =>
  `/my/project/${projectId}?tab=setup&${isError ? "error" : "ok"}=${encodeURIComponent(msg)}#bid-needs`;

export async function seedBidNeeds(projectId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_bid_needs_seed", { p_project: projectId });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error
    ? backSetup(projectId, error.message, true)
    : backSetup(projectId, "Bid list filled from the trade blueprint."));
}

export async function addBidNeed(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const label = String(formData.get("label") ?? "").trim();
  if (!label) redirect(backSetup(projectId, "Say what is needed.", true));
  const { error } = await supabase.rpc("portal_bid_need_add", {
    p_project: projectId,
    p_label: label,
    p_trade: String(formData.get("trade") ?? "").trim() || null,
    p_note: String(formData.get("note") ?? "").trim() || null,
    p_kind: String(formData.get("kind") ?? "trade"),
  });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error ? backSetup(projectId, error.message, true) : backSetup(projectId, `Added ${label}.`));
}

export async function removeBidNeed(projectId: string, needId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_bid_need_remove", { p_id: needId });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error ? backSetup(projectId, error.message, true) : backSetup(projectId, "Line removed."));
}

// ---------------------------------------------------------------------------
// Project scope, three steps (v188): trades → scope lines → bid packages.

const backScope = (projectId: string, step: string, msg: string, isError = false) =>
  `/my/project/${projectId}?tab=scope&step=${step}&${isError ? "error" : "ok"}=${encodeURIComponent(msg)}#scope`;

export async function scopeSetTrades(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const trades = formData.getAll("trade").map((v) => String(v));
  const { error } = await supabase.rpc("portal_scope_trades_set", { p_project: projectId, p_trades: trades });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error
    ? backScope(projectId, "1", error.message, true)
    : backScope(projectId, "2", `${trades.length} trade${trades.length === 1 ? "" : "s"} on this job.`));
}

export async function scopeCopyLines(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const lines = formData.getAll("line").map((v) => String(v));
  const { error } = await supabase.rpc("portal_scope_copy", { p_project: projectId, p_blueprint_ids: lines });
  revalidatePath(`/my/project/${projectId}`);
  redirect(error
    ? backScope(projectId, "2", error.message, true)
    : backScope(projectId, "3", `${lines.length} line${lines.length === 1 ? "" : "s"} in scope.`));
}

export async function scopeMakePackages(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_scope_packages", { p_project: projectId });
  revalidatePath(`/my/project/${projectId}`);
  const made = (data as { created?: number } | null)?.created ?? 0;
  redirect(error
    ? backScope(projectId, "3", error.message, true)
    : backScope(projectId, "3", made === 0
      ? "Every trade already has a package."
      : `${made} bid package${made === 1 ? "" : "s"} created from the scope.`));
}

// ---------------------------------------------------------------------------
// Evidence against a scope line (v198): the contractor who did the work and
// the owner who wrote the scope add to the same place.

export async function addScopeEvidence(projectId: string, scopeItemId: string, formData: FormData) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}?tab=scope`;
  const files = [...formData.getAll("files"), ...formData.getAll("videos"), ...formData.getAll("docs")]
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) {
    redirect(`${back}&error=${encodeURIComponent("Pick a photo or a file first.")}#scope-evidence`);
  }

  const role = String(formData.get("role") ?? "after");
  const failures: string[] = [];
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null }[] = [];
  let i = 0;
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const kind = isImage ? "photo" : isVideo ? "video" : isAudio ? "audio" : isPdf ? "document" : "other";
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = `${projectId}/scope/${scopeItemId}/${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { data: fileId, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `evidence${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: "Scope evidence", p_kind: kind,
    });
    if (recErr || !fileId) { failures.push(`${file.name}: ${recErr?.message ?? "not recorded"}`); i += 1; continue; }
    const { error: linkErr } = await supabase.rpc("portal_scope_evidence_attach", {
      p_file_id: fileId, p_scope_item: scopeItemId, p_role: role,
    });
    if (linkErr) { failures.push(`${file.name}: ${linkErr.message}`); i += 1; continue; }
    pending.push({ path, bytes, mime: file.type || null });
    i += 1;
  }
  after(async () => {
    for (const f of pending) {
      await supabase.storage.from("project-media").upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
    }
  });
  revalidatePath(`/my/project/${projectId}`);
  redirect(failures.length
    ? `${back}&error=${encodeURIComponent(`${failures.length} file(s) refused: ${failures.join(" · ")}`)}#scope-evidence`
    : `${back}&ok=${encodeURIComponent(`${pending.length} file${pending.length === 1 ? "" : "s"} added to the scope line.`)}#scope-evidence`);
}

// ---------------------------------------------------------------------------
// Crew on site (v199): arrive, leave, and the two things a hand carries —
// a photo and a voice note.

export async function siteCheck(projectId: string, kind: "arrive" | "leave", formData: FormData) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}`;
  const { error } = await supabase.rpc("portal_site_check", {
    p_project: projectId,
    p_kind: kind,
    p_note: String(formData.get("note") ?? "").trim() || null,
  });
  revalidatePath(back);
  redirect(error
    ? `${back}?error=${encodeURIComponent(error.message)}`
    : `${back}?ok=${encodeURIComponent(kind === "arrive" ? "Signed in to site ✓" : "Signed out of site ✓")}`);
}

export async function crewUpload(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}`;
  const files = [...formData.getAll("files"), ...formData.getAll("videos"), ...formData.getAll("docs")]
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) redirect(`${back}?error=${encodeURIComponent("Pick a photo first.")}`);

  const note = String(formData.get("note") ?? "").trim();
  const failures: string[] = [];
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null }[] = [];
  let i = 0;
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const kind = isImage ? "photo" : isVideo ? "video" : isAudio ? "audio" : "other";
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = `${projectId}/site/${new Date().toISOString().slice(0, 10)}/${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { data: fileId, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `site${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: note || "From site", p_kind: kind,
    });
    if (recErr || !fileId) { failures.push(`${file.name}: ${recErr?.message ?? "not recorded"}`); i += 1; continue; }
    pending.push({ path, bytes, mime: file.type || null });
    i += 1;
  }
  after(async () => {
    for (const f of pending) {
      await supabase.storage.from("project-media").upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
    }
  });
  revalidatePath(back);
  redirect(failures.length
    ? `${back}?error=${encodeURIComponent(`${failures.length} refused: ${failures.join(" · ")}`)}`
    : `${back}?ok=${encodeURIComponent(`${pending.length} file${pending.length === 1 ? "" : "s"} sent from site ✓`)}`);
}

// ---------------------------------------------------------------------------
// The project description and the files that travel with it (v201). These are
// the brief: what a bidder reads and prices from.

export async function saveScopeDescription(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}?tab=scope`;
  const p = await projectPerms(projectId);
  if (!p.notes) redirect(`${back}&error=${encodeURIComponent("Editing the description is not yours to do.")}#brief`);

  const { error } = await supabase.from("projects")
    .update({ notes: String(formData.get("description") ?? "").trim() || null, last_modified_by: "portal:scope" })
    .eq("id", projectId);
  revalidatePath(back);
  redirect(error
    ? `${back}&error=${encodeURIComponent(error.message)}#brief`
    : `${back}&ok=${encodeURIComponent("Description saved.")}#brief`);
}

export async function uploadScopeFiles(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}?tab=scope`;
  const files = [...formData.getAll("files"), ...formData.getAll("videos"), ...formData.getAll("docs")]
    .filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) redirect(`${back}&error=${encodeURIComponent("Pick a file first.")}#brief`);

  const failures: string[] = [];
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null }[] = [];
  let i = 0;
  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const isAudio = file.type.startsWith("audio/");
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const kind = isImage ? "photo" : isVideo ? "video" : isAudio ? "audio" : isPdf ? "document" : "other";
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    // The path carries "description-" so the brief picks it up wherever it is read.
    const path = `${projectId}/description-${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { data: fileId, error: recErr } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `description${ext}`,
      p_mime: file.type || null, p_size: file.size, p_caption: "Project description", p_kind: kind,
    });
    if (recErr || !fileId) { failures.push(`${file.name}: ${recErr?.message ?? "not recorded"}`); i += 1; continue; }
    pending.push({ path, bytes, mime: file.type || null });
    i += 1;
  }
  after(async () => {
    for (const f of pending) {
      await supabase.storage.from("project-media").upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
    }
  });
  revalidatePath(back);
  redirect(failures.length
    ? `${back}&error=${encodeURIComponent(`${failures.length} refused: ${failures.join(" · ")}`)}#brief`
    : `${back}&ok=${encodeURIComponent(`${pending.length} file${pending.length === 1 ? "" : "s"} added to the description.`)}#brief`);
}

export async function deleteScopeFile(projectId: string, fileId: string) {
  const supabase = await createClient();
  const back = `/my/project/${projectId}?tab=scope`;
  const { data, error } = await supabase.rpc("portal_project_file_delete", { p_file_id: fileId });
  if (error) redirect(`${back}&error=${encodeURIComponent(error.message)}#brief`);
  const gone = data as { bucket: string | null; path: string | null } | null;
  if (gone?.bucket && gone.path) {
    await supabase.storage.from(gone.bucket).remove([gone.path]);
  }
  revalidatePath(back);
  redirect(`${back}&ok=${encodeURIComponent("File deleted.")}#brief`);
}
