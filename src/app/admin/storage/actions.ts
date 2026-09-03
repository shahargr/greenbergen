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
