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
    // The landing page (052): whether to feature it. The photograph is
    // saved on its own by setPackagePhoto, so this form never clears it.
    promote: b(formData, "promote"),
  };
  const { data, error } = await supabase.rpc("admin_package_save", { p_code: code, p_patch: patch });
  if (error || data?.ok === false) {
    if (isNew) redirect(`/admin/packages?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Not saved.")}`);
    finish(code, false, data?.reason ?? error?.message ?? "Not saved.");
  }
  finish(data.code ?? code, true, isNew ? "Package created. Now give it scope lines and levers." : "Package saved.");
}

// EVERY ROW OF A SECTION AT ONCE (Shahar: "save works on one line at a
// time and I lose changes made to all other cells"). The form names every
// field field__rowkey; this reads them back into rows and writes each one
// through admin_package_row_save - the same rules, one row at a time, in
// one round. A blank new row is skipped. The row kind is the section's
// unless the row says otherwise (a lever section holds levers and their
// answers); an answer carries its lever as parent.
type Row = Record<string, string>;
const isNew = (key: string) => key === "new" || key.startsWith("new_");
const blank = (kind: string, r: Row) => {
  switch (kind) {
    case "item": return !r.label;
    case "milestone": return !r.key && !r.name;
    case "video": return !r.url && !r.label;
    default: return !r.key && !r.label; // lever, option, photo
  }
};
const title = (r: Row, key: string) => r.label || r.name || r.key || (isNew(key) ? "the new row" : key.slice(0, 8));

export async function saveRows(formData: FormData) {
  const supabase = await admin();
  const code = s(formData, "code");
  const kind = s(formData, "kind");
  const rows = new Map<string, Row>();
  for (const [k, v] of formData.entries()) {
    const m = k.match(/^([a-z_]+)__(.+)$/);
    if (!m || typeof v !== "string") continue;
    const row = rows.get(m[2]!) ?? {};
    row[m[1]!] = v.trim();
    rows.set(m[2]!, row);
  }
  // Existing rows first, new ones last, so a new answer lands under a
  // lever that has just been renamed rather than the other way round.
  const keys = [...rows.keys()].sort((a, b) => Number(isNew(a)) - Number(isNew(b)));
  const problems: string[] = [];
  let saved = 0;
  for (const key of keys) {
    const r = rows.get(key)!;
    const rowKind = r.rowkind || kind;
    if (isNew(key) && blank(rowKind, r)) continue;
    const delta = cents(r.price_delta ?? null);
    if (delta === "x") { problems.push(`${title(r, key)}: the price change is not a number.`); continue; }
    const patch: Record<string, string> = {
      label: r.label ?? "", detail: r.detail ?? "", kind: r.row_kind ?? "",
      key: r.key ?? "", question: r.question ?? "", control: r.control ?? "",
      chip: r.chip ?? "", price_delta_cents: delta, is_default: r.is_default ? "true" : "false",
      hint: r.hint ?? "", sort_order: r.sort_order ?? "",
      name: r.name ?? "", sequence_no: r.sequence_no ?? "",
      percent_of_contract: r.percent_of_contract ?? "", typical_range: r.typical_range ?? "",
      trigger_description: r.trigger_description ?? "",
      url: r.url ?? "", is_active: r.is_active ? "true" : "false",
      links: JSON.stringify(
        ([["Home Depot", r.link_home_depot ?? ""], ["Lowe's", r.link_lowes ?? ""]] as [string, string][])
          .filter(([, url]) => url).map(([label, url]) => ({ label, url }))),
    };
    const { data, error } = await supabase.rpc("admin_package_row_save", {
      p_kind: rowKind, p_id: isNew(key) ? null : key, p_parent: r.parent || code, p_patch: patch,
    });
    if (error || data?.ok === false) problems.push(`${title(r, key)}: ${data?.reason ?? error?.message ?? "not saved"}`);
    else saved++;
  }
  const noun = saved === 1 ? "row" : "rows";
  if (problems.length) finish(code, false, `${saved} ${noun} saved. Not saved - ${problems.join(" · ")}`, kind);
  finish(code, true, `${saved} ${noun} saved.`, kind);
}

// One row out. The X is a button inside the section's form carrying the
// row id as its value; the row kind is the row's own when the section
// mixes kinds (levers and answers), else the section's.
export async function deleteRow(formData: FormData) {
  const supabase = await admin();
  const code = s(formData, "code");
  const id = s(formData, "delete") || s(formData, "id");
  const kind = s(formData, `rowkind__${id}`) || s(formData, "kind");
  const { data, error } = await supabase.rpc("admin_package_row_delete", { p_kind: kind, p_id: id });
  if (error || data?.ok === false) finish(code, false, data?.reason ?? error?.message ?? "Not removed.", kind);
  finish(code, true, "Removed.", kind);
}

// The photograph of the work (052), recorded after the browser has put the
// file in public-media. An empty URL removes it. Returns instead of
// redirecting: the uploader stays on the page and shows the result.
export async function setPackagePhoto(code: string, url: string): Promise<{ ok?: true; error?: string }> {
  const supabase = await admin();
  const { data, error } = await supabase.rpc("admin_package_save", { p_code: code.toLowerCase(), p_patch: { photo_url: url } });
  if (error || data?.ok === false) return { error: data?.reason ?? error?.message ?? "Not saved." };
  revalidatePath("/admin/packages");
  revalidatePath(`/admin/packages/${code}`);
  return { ok: true };
}
