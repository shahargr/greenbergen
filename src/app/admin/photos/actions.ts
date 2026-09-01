"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Records an uploaded hero photo on the project's about page. Runs with the
// signed-in user's session - RLS decides (member_access on
// project_about_pages; only a superadmin reached the upload policy anyway).
// A row with ONLY hero_photo_url keeps the Master Template text, because
// about_page() falls back per field.
export async function setProjectPhoto(slug: string, publicUrl: string) {
  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("public_slug", slug)
    .maybeSingle();
  if (!project) return { error: "Project not found for that slug." };

  const { data: existing } = await supabase
    .from("project_about_pages")
    .select("id")
    .eq("project_id", project.id)
    .maybeSingle();

  const { error } = existing
    ? await supabase
        .from("project_about_pages")
        .update({ hero_photo_url: publicUrl, updated_by: "admin:photos" })
        .eq("id", existing.id)
    : await supabase
        .from("project_about_pages")
        .insert({ project_id: project.id, hero_photo_url: publicUrl, updated_by: "admin:photos" });

  if (error) return { error: "Saved the file but could not record it — try again." };

  revalidatePath("/");
  revalidatePath(`/p/${slug}`);
  revalidatePath("/admin/photos");
  return { ok: true, url: publicUrl };
}
