"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (msg: string, isError = false, hash = "") =>
  `/my/business?${isError ? "error" : "ok"}=${encodeURIComponent(msg)}${hash}`;
const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const bool = (fd: FormData, k: string) => (fd.get(k) != null ? "true" : "false");

export async function saveCompany(formData: FormData) {
  const supabase = await createClient();
  const payload: Record<string, string> = {};
  for (const k of ["company_name", "legal_name", "dba", "address", "main_phone", "main_email",
                   "website", "ein", "license_number", "service_zip", "service_radius_miles",
                   "w9_tax_classification"]) {
    if (formData.has(k)) payload[k] = txt(formData, k);
  }
  for (const k of ["serves_adjacent_states", "can_provide_workers_comp",
                   "can_provide_liability_insurance", "can_provide_gc_insurance"]) {
    if (formData.has(`${k}__present`)) payload[k] = bool(formData, k);
  }
  const { error } = await supabase.rpc("portal_my_company_save", { p: payload });
  revalidatePath("/my/business");
  redirect(error ? back(error.message, true) : back("Company saved."));
}

export async function saveTerms(formData: FormData) {
  const supabase = await createClient();
  const payload: Record<string, string> = { auto_bid: bool(formData, "auto_bid") };
  for (const k of ["auto_bid_note", "net_days", "deposit_pct", "retainage_pct",
                   "invoice_email", "preferred_payment", "warranty_terms"]) {
    if (formData.has(k)) payload[k] = txt(formData, k);
  }
  const { error } = await supabase.rpc("portal_my_terms_save", { p: payload });
  revalidatePath("/my/business");
  redirect(error ? back(error.message, true, "#terms") : back("Terms saved.", false, "#terms"));
}

export async function savePriceItem(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_price_item_save", {
    p: {
      id: txt(formData, "id") || null,
      trade: txt(formData, "trade") || null,
      item: txt(formData, "item"),
      unit: txt(formData, "unit") || "each",
      unit_price: txt(formData, "unit_price") || null,
      notes: txt(formData, "notes") || null,
    },
  });
  revalidatePath("/my/business");
  redirect(error ? back(error.message, true, "#prices") : back("Price line saved.", false, "#prices"));
}

export async function deletePriceItem(itemId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_price_item_delete", { p_id: itemId });
  revalidatePath("/my/business");
  redirect(error ? back(error.message, true, "#prices") : back("Price line removed.", false, "#prices"));
}

// A business document: W9, insurance certificate, warranty, bond. Same store
// and same privacy as a licence — the file lands under your own contact id.
export async function saveBusinessDoc(formData: FormData) {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const contactId = me?.contact_id as string | undefined;
  if (!contactId) redirect(back("Your account has no contact record yet.", true, "#papers"));

  const file = formData.get("file");
  let bucket: string | null = null;
  let path: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 15 * 1024 * 1024) redirect(back("That file is over 15 MB.", true, "#papers"));
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    path = `${contactId}/${crypto.randomUUID()}${ext}`;
    const { error: upErr } = await supabase.storage.from("credentials")
      .upload(path, await file.arrayBuffer(), { contentType: file.type || undefined, upsert: false });
    if (upErr) redirect(back(`Upload refused: ${upErr.message}`, true, "#papers"));
    bucket = "credentials";
    fileName = file.name;
  }

  const { error } = await supabase.rpc("portal_credential_save", {
    p: {
      kind: txt(formData, "kind") || "w9",
      label: txt(formData, "label"),
      issuer: txt(formData, "issuer") || null,
      expires_on: txt(formData, "expires_on") || null,
      notes: txt(formData, "notes") || null,
      bucket, path, file_name: fileName,
    },
  });
  revalidatePath("/my/business");
  redirect(error ? back(error.message, true, "#papers") : back("Document saved.", false, "#papers"));
}
