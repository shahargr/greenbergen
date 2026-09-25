"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Admin > Mark-up (migration 237). Every function checks is_superadmin
// itself; these only carry the form to it and come back with the answer.
const back = (data: { ok?: boolean; reason?: string } | null, error: { message: string } | null, saved: string) =>
  redirect(error || !data?.ok
    ? `/admin/markup?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not save.")}`
    : `/admin/markup?saved=${encodeURIComponent(saved)}`);

// "15" and "15.5" are percents; an empty box means "no override".
const pct = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim().replace(/%$/, "");
  return s === "" ? null : Number(s);
};

export async function saveMarkup(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_markup_set", { p_pct: pct(formData.get("pct")) });
  back(data, error, "The mark-up is saved. New bookings use it; nobody who already booked is re-priced.");
}

export async function saveGroup(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "") || null;
  const { data, error } = await supabase.rpc("admin_user_group_save", {
    p_id: id, p_name: String(formData.get("name") ?? ""), p_markup_pct: pct(formData.get("pct")),
    p_notes: String(formData.get("notes") ?? ""), p_is_active: id ? formData.get("active") === "1" : true,
  });
  back(data, error, id ? "Group saved." : "Group added. Add its members below.");
}

export async function addMember(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_group_member_set", {
    p_group_id: String(formData.get("group") ?? ""), p_email: String(formData.get("email") ?? ""), p_on: true,
  });
  back(data, error, data?.moved_from ? `Added - moved out of ${data.moved_from}, since a person is in one group at a time.` : "Added.");
}

export async function removeMember(groupId: string, email: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_user_group_member_set", { p_group_id: groupId, p_email: email, p_on: false });
  back(data, error, "Removed. They pay the standard mark-up from their next booking.");
}
