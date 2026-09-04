"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
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

  const rows: { project_id: string; key: string; label: string; value: string | null; updated_by: string }[] = [];
  for (const [key, raw] of formData.entries()) {
    if (typeof raw !== "string") continue;
    rows.push({ project_id: projectId, key, label: key.replace(/_/g, " "), value: raw.trim() || null, updated_by: who });
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
export async function deleteProject(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("trash_own_project", { p_project_id: projectId });
  if (error || !data?.ok) {
    redirect(`/my/project/${projectId}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not delete.")}`);
  }
  revalidatePath("/my");
  redirect(`/my?ok=${encodeURIComponent(`Moved to the recycle bin — restore within ${data.days} days from Settings.`)}`);
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
  const back = `/my/project/${projectId}?tab=visit`;
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
    pending.push({ path, bytes, mime: file.type || null });
    i += 1;
  }
  after(async () => {
    for (const f of pending) {
      await supabase.storage.from("project-media").upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
    }
  });
  revalidatePath(`/my/project/${projectId}`);
  if (failures.length) redirect(`${back}&error=${encodeURIComponent(`Visit logged; ${failures.length} file(s) refused: ${failures.join(" · ")}`)}`);
  redirect(`${back}&ok=${encodeURIComponent(`Visit logged${pending.length ? ` with ${pending.length} file${pending.length === 1 ? "" : "s"}` : ""} ✓`)}`);
}
