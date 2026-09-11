"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// SITE VISITS (migration 068). Shahar, 2026-09-11: "remove the toggle i'm on
// site / leaving. log a site visit / allow to add voice / text /
// files-image. after logged show the line, and allow to edit it / delete it."
//
// The arrive/leave pair is gone with its two taps. A visit is one entry - the
// day, what you saw, and whatever you attached - and it can be corrected or
// removed like any other record. Every rule is in the database functions;
// these shape the form and route back.

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };
const ids = (v: FormDataEntryValue | null) =>
  String(v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const here = (projectId: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `/project/${projectId}${q ? `?${q}` : ""}`;
};

export async function logVisit(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const files = ids(formData.get("file_ids"));
  const { data, error } = await supabase.rpc("portal_site_visit_log", {
    p_project: projectId,
    p_note: txt(formData.get("note")),
    p_file_ids: files.length > 0 ? files : null,
    p_on: txt(formData.get("on_date")),
  });
  revalidatePath(`/project/${projectId}`);
  revalidatePath("/");
  if (error) redirect(here(projectId, { error: friendly(error.message, "That visit did not save.") }));
  if (!data?.ok) redirect(here(projectId, { error: data?.reason ?? "That visit did not save." }));
  redirect(here(projectId, { ok: "visit" }));
}

export async function editVisit(projectId: string, visitId: string, formData: FormData) {
  const supabase = await createClient();
  const files = ids(formData.get("file_ids"));
  const { data, error } = await supabase.rpc("portal_site_visit_edit", {
    p_id: visitId,
    p_note: txt(formData.get("note")),
    p_file_ids: files.length > 0 ? files : null,
  });
  revalidatePath(`/project/${projectId}`);
  if (error) redirect(here(projectId, { error: friendly(error.message, "That change did not save.") }));
  if (!data?.ok) redirect(here(projectId, { error: data?.reason ?? "That change did not save." }));
  redirect(here(projectId, { ok: "visit-edit" }));
}

export async function deleteVisit(projectId: string, visitId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_site_visit_delete", { p_id: visitId });
  revalidatePath(`/project/${projectId}`);
  if (error) redirect(here(projectId, { error: friendly(error.message, "That visit was not removed.") }));
  if (!data?.ok) redirect(here(projectId, { error: data?.reason ?? "That visit was not removed." }));
  redirect(here(projectId, { ok: "visit-gone" }));
}
