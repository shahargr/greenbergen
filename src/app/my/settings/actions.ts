"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Profile: full name on the account, phone and full address on the contact.
// RLS decides - own_profile_update / own_contacts_update.
export async function saveProfile(formData: FormData) {
  const fullName = String(formData.get("full_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  if (!me?.app_user_id) redirect("/login");

  await supabase
    .from("app_users")
    .update({ full_name: fullName || null })
    .eq("id", me.app_user_id);

  if (me.contact_id) {
    await supabase
      .from("contacts")
      .update({
        phone: phone || null,
        address: address || null,
        last_modified_by: "portal:settings",
      })
      .eq("id", me.contact_id);
  }

  revalidatePath("/my/settings");
  redirect("/my/settings?saved=profile");
}

// Direct-sale listing: the owner names a price on their home asset.
// Empty price = not for sale (clears the intent).
export async function saveAskingPrice(formData: FormData) {
  const assetId = String(formData.get("asset") ?? "").trim();
  const raw = String(formData.get("price") ?? "").replace(/[^0-9.]/g, "");
  const price = raw ? Number(raw) : null;

  const supabase = await createClient();
  const { error } = await supabase
    .from("assets")
    .update({
      asking_price: price !== null && Number.isFinite(price) && price > 0 ? price : null,
      last_modified_by: "portal:settings",
    })
    .eq("id", assetId);

  revalidatePath("/my/settings");
  redirect(error ? `/my/settings?error=${encodeURIComponent("Could not save the price — try again.")}` : "/my/settings?saved=price");
}
