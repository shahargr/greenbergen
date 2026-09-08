"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || null;

export async function saveBusiness(formData: FormData) {
  const supabase = await createClient();
  const radius = Number(formData.get("service_radius_miles"));
  const { data, error } = await supabase.rpc("contractor_business_save", {
    p_name: text(formData, "name"), p_legal_name: text(formData, "legal_name"),
    p_phone: text(formData, "phone"), p_email: text(formData, "email"),
    p_website: text(formData, "website"), p_address: text(formData, "address"),
    p_ein: text(formData, "ein"), p_license_number: text(formData, "license_number"),
    p_service_zip: text(formData, "service_zip"),
    p_service_radius_miles: Number.isFinite(radius) && radius > 0 ? Math.round(radius) : null,
  });
  revalidatePath("/business");
  revalidatePath("/work");
  if (error || !data?.ok) redirect(`/business?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect("/business?ok=1");
}

export async function saveTrades(formData: FormData) {
  const trades = formData.getAll("trade").map(String).filter(Boolean);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("contractor_trades_set", { p_trades: trades });
  revalidatePath("/business/trades");
  revalidatePath("/work");
  if (error || !data?.ok) redirect(`/business/trades?error=${encodeURIComponent(friendly(data?.reason ?? error?.message))}`);
  redirect("/business/trades?ok=1");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}
