"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// project_about_pages has NO id column - project_id IS the primary key,
// which makes upsert the natural write.
async function projectIdFor(slug: string) {
  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("public_slug", slug)
    .maybeSingle();
  return { supabase, projectId: (project?.id as string) ?? null };
}

// Records an uploaded hero photo on the project's about page. Runs with the
// signed-in user's session - RLS decides. A row carrying only some fields
// keeps the Master Template text for the rest: about_page() falls back per field.
export async function setProjectPhoto(slug: string, publicUrl: string) {
  const { supabase, projectId } = await projectIdFor(slug);
  if (!projectId) return { error: "Project not found for that slug." };

  const { error } = await supabase
    .from("project_about_pages")
    .upsert(
      { project_id: projectId, hero_photo_url: publicUrl, updated_by: "admin:photos" },
      { onConflict: "project_id" },
    );

  if (error) return { error: "Saved the file but could not record it — try again." };

  revalidatePath("/");
  revalidatePath(`/p/${slug}`);
  revalidatePath("/admin/photos");
  return { ok: true, url: publicUrl };
}

// Saves the editable public-page text and scope facts. Empty fields become
// NULL so the Master Template takes over for that field again.
export async function savePublicPage(
  slug: string,
  fields: {
    headline: string;
    body: string;
    scope_note: string;
    garage_note: string;
    total_sqft: string;
    built_year: string;
  },
) {
  const { supabase, projectId } = await projectIdFor(slug);
  if (!projectId) return { error: "Project not found for that slug." };

  const sqft = parseInt(fields.total_sqft.replace(/[^0-9]/g, ""), 10);
  const built = parseInt(fields.built_year.replace(/[^0-9]/g, ""), 10);
  const values = {
    project_id: projectId,
    headline: fields.headline.trim() || null,
    body: fields.body.trim() || null,
    scope_note: fields.scope_note.trim() || null,
    garage_note: fields.garage_note.trim() || null,
    total_sqft: Number.isFinite(sqft) && sqft > 0 ? sqft : null,
    built_year: Number.isFinite(built) && built >= 1800 && built <= 2100 ? built : null,
    updated_by: "admin:photos",
  };

  const { error } = await supabase
    .from("project_about_pages")
    .upsert(values, { onConflict: "project_id" });

  if (error) return { error: `Could not save — ${error.message}` };

  revalidatePath("/");
  revalidatePath(`/p/${slug}`);
  revalidatePath("/admin/photos");
  return { ok: true };
}
