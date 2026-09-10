"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// The package editor's writes. Every rule lives in the database
// (admin_package_save, admin_package_row_save, admin_package_row_delete,
// migration 045): superadmin only, the CHECK vocabularies, one default per
// lever. This file relays and comes back to the package with a flash.

async function admin() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  if (!me?.is_superadmin) redirect("/my");
  return supabase;
}

const back = (code: string, msg: string, isError = false, anchor = "") =>
  `/admin/packages/${encodeURIComponent(code)}?${isError ? "error" : "saved"}=${encodeURIComponent(msg)}${anchor ? `#${anchor}` : ""}`;

function finish(code: string, ok: boolean, msg: string, anchor = "") {
  revalidatePath("/admin/packages");
  revalidatePath(`/admin/packages/${code}`);
  redirect(back(code, msg, !ok, anchor));
}

// Dollars in the form, cents in the database. "1,180" and "$1,180.00" both
// read as 118000; blank stays blank (null).
function cents(v: FormDataEntryValue | null): string {
  const s = String(v ?? "").replace(/[$,\s]/g, "");
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(Math.round(n * 100)) : "x";
}

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const b = (fd: FormData, k: string) => (fd.get(k) ? "true" : "false");

export async function savePackage(formData: FormData) {
  const supabase = await admin();
  const code = s(formData, "code").toLowerCase();
  const isNew = s(formData, "new") === "1";
  const base = cents(formData.get("base_price"));
  if (base === "x") finish(code, false, "The base price is not a number.");
  const patch = {
    name: s(formData, "name"), tile_title: s(formData, "tile_title"), tile_line2: s(formData, "tile_line2"),
    trade: s(formData, "trade"), category: s(formData, "category"), tile_group: s(formData, "tile_group"),
    availability: s(formData, "availability"), base_price_cents: base, config_label: s(formData, "config_label"),
    description: s(formData, "description"), approval_note: s(formData, "approval_note"),
    illustration: s(formData, "illustration"), sort_order: s(formData, "sort_order"),
    permit_deposit_pct: s(formData, "permit_deposit_pct"), season_months: s(formData, "season_months"),
    requires_permit: b(formData, "requires_permit"), instant_book: b(formData, "instant_book"), is_active: b(formData, "is_active"),
  };
  const { data, error } = await supabase.rpc("admin_package_save", { p_code: code, p_patch: patch });
  if (error || data?.ok === false) {
    if (isNew) redirect(`/admin/packages?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Not saved.")}`);
    finish(code, false, data?.reason ?? error?.message ?? "Not saved.");
  }
  finish(data.code ?? code, true, isNew ? "Package created. Now give it scope lines and levers." : "Package saved.");
}

// One child row: item, lever, option, photo, milestone. Blank id inserts.
export async function saveRow(formData: FormData) {
  const supabase = await admin();
  const code = s(formData, "code");
  const kind = s(formData, "kind");
  const id = s(formData, "id") || null;
  const parent = s(formData, "parent") || code;
  const delta = cents(formData.get("price_delta"));
  if (delta === "x") finish(code, false, "That price change is not a number.", kind);
  const patch: Record<string, string> = {
    label: s(formData, "label"), detail: s(formData, "detail"), kind: s(formData, "row_kind"),
    key: s(formData, "key"), question: s(formData, "question"), control: s(formData, "control"),
    chip: s(formData, "chip"), price_delta_cents: delta, is_default: b(formData, "is_default"),
    hint: s(formData, "hint"), sort_order: s(formData, "sort_order"),
    name: s(formData, "name"), sequence_no: s(formData, "sequence_no"),
    percent_of_contract: s(formData, "percent_of_contract"), typical_range: s(formData, "typical_range"),
    trigger_description: s(formData, "trigger_description"),
    url: s(formData, "url"), is_active: b(formData, "is_active"),
  };
  // Milestone kind rides in row_kind too; the function reads 'kind'.
  const { data, error } = await supabase.rpc("admin_package_row_save", { p_kind: kind, p_id: id, p_parent: parent, p_patch: patch });
  if (error || data?.ok === false) finish(code, false, data?.reason ?? error?.message ?? "Not saved.", kind);
  finish(code, true, id ? "Saved." : "Added.", kind);
}

export async function deleteRow(formData: FormData) {
  const supabase = await admin();
  const code = s(formData, "code");
  const kind = s(formData, "kind");
  const id = s(formData, "id");
  const { data, error } = await supabase.rpc("admin_package_row_delete", { p_kind: kind, p_id: id });
  if (error || data?.ok === false) finish(code, false, data?.reason ?? error?.message ?? "Not removed.", kind);
  finish(code, true, "Removed.", kind);
}
