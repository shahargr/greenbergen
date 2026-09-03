"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function recordStorageOp(op: "backup" | "optimization") {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_storage_op", { p_op: op });
  redirect(error || !data?.ok
    ? `/admin/storage?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Failed.")}`
    : `/admin/storage?saved=1`);
}

// Change a user's media plan (from the plans table).
export async function setUserPlan(userId: string, formData: FormData) {
  const supabase = await createClient();
  const plan = String(formData.get("plan") ?? "");
  const { error } = await supabase.rpc("set_user_plan", { p_user: userId, p_plan: plan });
  redirect(error ? `/admin/storage?error=${encodeURIComponent(error.message)}` : `/admin/storage?saved=1`);
}

// Set or clear a per-user quota override, entered in MB (blank clears it).
export async function setUserQuota(userId: string, formData: FormData) {
  const supabase = await createClient();
  const raw = String(formData.get("mb") ?? "").trim();
  const bytes = raw === "" ? null : Math.round(Number(raw) * 1024 * 1024);
  if (raw !== "" && (!Number.isFinite(bytes!) || bytes! < 0)) {
    redirect(`/admin/storage?error=${encodeURIComponent("Enter a number of MB, or blank to clear.")}`);
  }
  const { error } = await supabase.rpc("set_user_quota_override", { p_user: userId, p_bytes: bytes });
  redirect(error ? `/admin/storage?error=${encodeURIComponent(error.message)}` : `/admin/storage?saved=1`);
}
