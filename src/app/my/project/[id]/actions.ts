"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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
  revalidatePath("/my");
  redirect(`/my?ok=${encodeURIComponent(`${data.name} restored ✓`)}`);
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
  revalidatePath("/my");
  redirect(`/my?ok=${encodeURIComponent("Project deleted permanently.")}`);
}
