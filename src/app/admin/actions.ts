"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Saves the community banner (dashboard headline + link). One live banner:
// the newest row wins on the dashboard, so saving updates the latest row or
// creates the first one. RLS allows this to superadmin only.
export async function saveBanner(formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  const url = String(formData.get("url") ?? "").trim();
  const active = formData.get("active") === "on";

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("community_banners")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const values = {
    text,
    url: url || null,
    is_active: active && text.length > 0,
    created_by: "admin:overview",
    last_modified_at: new Date().toISOString(),
  };

  if (existing) {
    await supabase.from("community_banners").update(values).eq("id", existing.id);
  } else {
    await supabase.from("community_banners").insert(values);
  }

  revalidatePath("/my");
  revalidatePath("/admin");
}
