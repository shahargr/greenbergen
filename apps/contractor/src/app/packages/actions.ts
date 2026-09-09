"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";

// Sign up to serve a package, pause it, or change the price you call for
// the basic setup. expert_package_signup (migration 045) checks the trade
// is yours and writes the one row; this relays and comes back to the list.
export async function setPackage(formData: FormData) {
  const code = String(formData.get("code") ?? "").trim();
  const on = String(formData.get("on") ?? "") === "1";
  const raw = String(formData.get("price") ?? "").replace(/[$,\s]/g, "");
  const note = String(formData.get("note") ?? "").trim() || null;
  let price: number | null = null;
  if (raw) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) redirect(`/packages?error=${encodeURIComponent("That price is not a number.")}#${code}`);
    price = Math.round(n * 100);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("expert_package_signup", { p_code: code, p_on: on, p_price_cents: price, p_note: note });
  revalidatePath("/packages");
  revalidatePath("/work");
  if (error || data?.ok === false) redirect(`/packages?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Not saved.")}#${code}`);
  redirect(`/packages?ok=${encodeURIComponent(on ? "You're serving it." : "Paused. Offers keep coming by trade; your standing on this package is paused.")}#${code}`);
}
