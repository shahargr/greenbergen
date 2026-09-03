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
  const radius = Number(String(formData.get("radius") ?? "").trim());
  const windowDays = Number(String(formData.get("window_days") ?? "").trim());
  return {
    pricing_mode: formData.get("pricing_mode") === "cluster" ? "cluster" : "flat",
    radius_miles: Number.isFinite(radius) && radius > 0 ? radius : 0.5,
    window_days: Number.isFinite(windowDays) && windowDays >= 1 ? Math.round(windowDays) : 3,
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

// The contractual ladder, one tier per line: "houses, price[, label]" -
// e.g. "1, 249, list" / "2, 219, back-to-back" / "4, 189, street run".
function parseLadder(formData: FormData) {
  return String(formData.get("ladder") ?? "")
    .split(/\r?\n/)
    .map((line) => line.split(",").map((s) => s.trim()))
    .filter((parts) => parts.length >= 2 && /^\d+$/.test(parts[0]) && parts[1] !== "")
    .map((parts) => ({
      min_houses: Number(parts[0]),
      price_cents: Math.round(Number(parts[1].replace(/[$\s]/g, "")) * 100),
      label: parts.slice(2).join(",").trim() || null,
    }))
    .filter((t) => t.min_houses >= 1 && Number.isFinite(t.price_cents) && t.price_cents >= 0);
}

async function saveLadder(supabase: Awaited<ReturnType<typeof createClient>>, dealId: string, formData: FormData) {
  const { data, error } = await supabase.rpc("deal_tiers_set", { p_promotion: dealId, p_tiers: parseLadder(formData) });
  if (error || !data?.ok) redirect("/admin/deals?error=" + encodeURIComponent(data?.reason ?? error?.message ?? "Could not save the ladder."));
}

export async function createDeal(formData: FormData) {
  const supabase = await createClient();
  const d = parseDeal(formData);
  if (!d.title) redirect("/admin/deals?error=" + encodeURIComponent("The deal needs a title."));
  if (d.service_dates.length === 0 && d.pricing_mode === "flat") {
    redirect("/admin/deals?error=" + encodeURIComponent("Give at least one service date (YYYY-MM-DD)."));
  }
  if (d.pricing_mode === "cluster" && parseLadder(formData).length === 0) {
    redirect("/admin/deals?error=" + encodeURIComponent("A clustered deal needs its ladder — at least the 1-house list price."));
  }
  const { data: row, error } = await supabase.from("promotions").insert({
    ...d,
    starts_on: new Date().toISOString().slice(0, 10),
    min_signups: 1,
  }).select("id").maybeSingle();
  if (error || !row) redirect("/admin/deals?error=" + encodeURIComponent(error?.message ?? "Could not create the deal."));
  if (d.pricing_mode === "cluster") await saveLadder(supabase, row.id as string, formData);
  revalidatePath("/admin/deals");
  revalidatePath("/deals");
  revalidatePath("/my");
  redirect("/admin/deals?saved=1");
}

export async function updateDeal(dealId: string, formData: FormData) {
  const supabase = await createClient();
  const d = parseDeal(formData);
  if (!d.title) redirect("/admin/deals?error=" + encodeURIComponent("The deal needs a title."));
  const { error } = await supabase.from("promotions").update(d).eq("id", dealId);
  if (error) redirect("/admin/deals?error=" + encodeURIComponent(error.message));
  if (d.pricing_mode === "cluster") await saveLadder(supabase, dealId, formData);
  revalidatePath("/admin/deals");
  revalidatePath("/deals");
  revalidatePath("/my");
  redirect("/admin/deals?saved=1");
}

// Lock a forming cluster: tier fixed, run order and start set, members
// confirmed at that price. From here the run is a commitment to the vendor.
export async function lockCluster(clusterId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deal_cluster_lock", { p_cluster: clusterId });
  revalidatePath("/admin/deals");
  revalidatePath("/my");
  redirect(error || !data?.ok
    ? "/admin/deals?error=" + encodeURIComponent(data?.reason ?? error?.message ?? "Could not lock.")
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
