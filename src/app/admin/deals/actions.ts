"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Admin-only by RLS (promotions_admin policy). Dates arrive as a
// comma/space separated list of YYYY-MM-DD; price in dollars.
function parseDeal(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const dates = String(formData.get("dates") ?? "")
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
  const priceRaw = String(formData.get("price") ?? "").replace(/[$,\s]/g, "");
  const price = priceRaw === "" ? null : Math.round(Number(priceRaw) * 100);
  const slotsRaw = String(formData.get("slots") ?? "").trim();
  return {
    title,
    summary: String(formData.get("summary") ?? "").trim() || null,
    detail: String(formData.get("detail") ?? "").trim() || null,
    trade: String(formData.get("trade") ?? "").trim() || null,
    town: String(formData.get("town") ?? "").trim() || null,
    state_cd: String(formData.get("state") ?? "NJ").trim().toUpperCase() || "NJ",
    offer_terms: String(formData.get("terms") ?? "").trim() || null,
    price_cents: price != null && Number.isFinite(price) && price >= 0 ? price : null,
    service_dates: dates,
    max_signups: slotsRaw && Number(slotsRaw) >= 1 ? Number(slotsRaw) : null,
    status: String(formData.get("status") ?? "draft"),
  };
}

export async function createDeal(formData: FormData) {
  const supabase = await createClient();
  const d = parseDeal(formData);
  if (!d.title) redirect("/admin/deals?error=" + encodeURIComponent("The deal needs a title."));
  if (d.service_dates.length === 0) {
    redirect("/admin/deals?error=" + encodeURIComponent("Give at least one service date (YYYY-MM-DD)."));
  }
  const { error } = await supabase.from("promotions").insert({
    ...d,
    starts_on: new Date().toISOString().slice(0, 10),
    min_signups: 1,
  });
  revalidatePath("/admin/deals");
  revalidatePath("/deals");
  redirect(error
    ? "/admin/deals?error=" + encodeURIComponent(error.message)
    : "/admin/deals?saved=1");
}

export async function updateDeal(dealId: string, formData: FormData) {
  const supabase = await createClient();
  const d = parseDeal(formData);
  if (!d.title) redirect("/admin/deals?error=" + encodeURIComponent("The deal needs a title."));
  const { error } = await supabase.from("promotions").update(d).eq("id", dealId);
  revalidatePath("/admin/deals");
  revalidatePath("/deals");
  redirect(error
    ? "/admin/deals?error=" + encodeURIComponent(error.message)
    : "/admin/deals?saved=1");
}

export async function markBookingPaid(bookingId: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("promotion_signups")
    .update({ status: "paid", paid_at: new Date().toISOString(), payment_ref: "manual:admin" })
    .eq("id", bookingId);
  revalidatePath("/admin/deals");
  redirect(error
    ? "/admin/deals?error=" + encodeURIComponent(error.message)
    : "/admin/deals?saved=1");
}
