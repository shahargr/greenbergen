"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// THE OWNER'S WRITES ON THEIR OWN HOUSE PAGE. Every rule is in the database
// (house_page_save, house_page_publish, house_photo_add, house_photo_edit):
// who may change this house, where a published copy of a photograph is
// allowed to go, and whether a page with nothing on it may go out. Nothing
// here decides anything.
//
// THE ONE THING SQL CANNOT DO is move the bytes. The job's photographs live
// in the PRIVATE project-media bucket and anon cannot be handed a signed URL
// for them - there is no session to sign with - so a picked photograph is
// COPIED into the public bucket. The path is the database's to decide
// (house_photo_path) and a storage policy allows that path only to somebody
// who may edit the house, so a copy cannot be aimed anywhere else.

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const int = (v: FormDataEntryValue | null) => {
  const n = num(v);
  return n == null ? null : Math.round(n);
};
const on = (form: FormData, name: string) => form.has(name);

const here = (id: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `/my/house/${id}/public${q ? `?${q}` : ""}`;
};

export async function saveHousePage(id: string, formData: FormData) {
  const supabase = await createClient();
  const features = String(formData.get("features") ?? "")
    .split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

  const { data, error } = await supabase.rpc("house_page_save", {
    p_project: id,
    p_purpose: txt(formData.get("purpose")),
    p_headline: txt(formData.get("headline")),
    p_body: txt(formData.get("body")),
    p_price: num(formData.get("price")),
    p_price_note: txt(formData.get("price_note")),
    p_beds: num(formData.get("beds")),
    p_baths: num(formData.get("baths")),
    p_sqft: int(formData.get("sqft")),
    p_lot_size: txt(formData.get("lot_size")),
    p_built_year: int(formData.get("built_year")),
    p_available_from: txt(formData.get("available_from")),
    p_features: features.length > 0 ? features : null,
    p_contact_name: txt(formData.get("contact_name")),
    p_contact_phone: txt(formData.get("contact_phone")),
    p_contact_email: txt(formData.get("contact_email")),
    p_address_display: txt(formData.get("address_display")),
    // A tick box that is off sends nothing at all, so each one is read as
    // present-or-absent rather than as a value.
    p_show_price: on(formData, "show_price"),
    p_show_facts: on(formData, "show_facts"),
    p_show_plans: on(formData, "show_plans"),
    p_show_build: on(formData, "show_build"),
    p_show_form: on(formData, "show_form"),
  });

  revalidatePath(here(id));
  if (error || !data?.ok) {
    redirect(here(id, { error: data?.reason ?? "That did not save." }));
  }
  redirect(here(id, { ok: "saved" }));
}

export async function publishHousePage(id: string, formData: FormData) {
  const supabase = await createClient();
  const wanted = String(formData.get("on") ?? "") === "1";
  const { data, error } = await supabase.rpc("house_page_publish", { p_project: id, p_on: wanted });

  revalidatePath(here(id));
  if (data?.slug) revalidatePath(`/p/${data.slug as string}`);
  if (error || !data?.ok) {
    redirect(here(id, { error: data?.reason ?? "That did not change." }));
  }
  redirect(here(id, { ok: wanted ? "live" : "draft" }));
}

// PICK A PHOTOGRAPH THAT IS ALREADY IN THE JOB. Copy first, record second: a
// copy with no row is a stray file nobody sees, while a row with no copy is a
// broken picture on a public page.
export async function pickPhoto(id: string, formData: FormData) {
  const supabase = await createClient();
  const fileId = txt(formData.get("file_id"));
  const bucket = txt(formData.get("bucket")) ?? "project-media";
  const path = txt(formData.get("path"));
  const kind = txt(formData.get("kind")) ?? "photo";
  if (!fileId || !path) redirect(here(id, { error: "Pick a photograph first." }));

  const { data: dest, error: pathErr } = await supabase.rpc("house_photo_path", {
    p_project: id, p_file: fileId,
  });
  if (pathErr || !dest) {
    redirect(here(id, { error: "That photograph has nowhere to go - the house has no page address yet." }));
  }

  const copy = await supabase.storage.from(bucket).copy(path, dest as string, {
    destinationBucket: "public-media",
  });
  // A second pick of the same photograph lands on the same path, and the
  // bucket says the object is already there. That is not a failure.
  if (copy.error && !/exist/i.test(copy.error.message ?? "")) {
    redirect(here(id, { error: `Could not publish that photograph: ${copy.error.message}` }));
  }

  const { data, error } = await supabase.rpc("house_photo_add", {
    p_project: id, p_file: fileId, p_public_path: dest as string,
    p_kind: kind, p_caption: txt(formData.get("caption")),
  });
  revalidatePath(here(id));
  if (error || !data?.ok) {
    redirect(here(id, { error: data?.reason ?? "That photograph did not go on the page." }));
  }
  redirect(here(id, { ok: "photo" }));
}

export async function editPhoto(id: string, photoId: string, formData: FormData) {
  const supabase = await createClient();
  const drop = String(formData.get("drop") ?? "") === "1";
  const move = int(formData.get("move"));
  const cover = String(formData.get("cover") ?? "") === "1";

  const { data, error } = await supabase.rpc("house_photo_edit", {
    p_photo: photoId,
    p_move: move,
    p_cover: cover ? true : null,
    p_caption: txt(formData.get("caption")),
    p_drop: drop,
  });

  // Dropped from the page, so the public copy goes too - the page is the only
  // reason it was ever in a public bucket.
  if (!error && data?.ok && data?.dropped && data?.path) {
    await supabase.storage.from("public-media").remove([data.path as string]);
  }

  revalidatePath(here(id));
  if (error || !data?.ok) {
    redirect(here(id, { error: data?.reason ?? "That picture did not change." }));
  }
  redirect(here(id, { ok: drop ? "dropped" : "photo" }));
}
