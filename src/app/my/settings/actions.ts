"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { verifyUsAddress } from "@/lib/geocode";

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

  // Verify the address against the Census geocoder; a match saves the
  // standardized form, a miss saves as typed with an honest note.
  let verified: boolean | null = null;
  let finalAddress = address || null;
  if (address) {
    const standardized = await verifyUsAddress(address);
    verified = standardized !== null;
    if (standardized) finalAddress = standardized;
  }

  // Optional profile photo: into the PUBLIC bucket at a stable per-contact
  // path (upsert), so task panels can use a plain URL. No file = keep what's
  // there (the icon if none). RLS only lets a user write their own avatar.
  let avatarPath: string | null = null;
  let avatarErr: string | null = null;
  const avatar = formData.get("avatar");
  if (me.contact_id && avatar instanceof File && avatar.size > 0) {
    if (!avatar.type.startsWith("image/")) {
      avatarErr = "The profile photo must be an image.";
    } else if (avatar.size > 5 * 1024 * 1024) {
      avatarErr = "Profile photo must be under 5 MB.";
    } else {
      const ext = (avatar.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
      const path = `avatars/${me.contact_id}${ext}`;
      const { error: upErr } = await supabase.storage
        .from("public-media")
        .upload(path, await avatar.arrayBuffer(), { contentType: avatar.type, upsert: true });
      if (upErr) avatarErr = `Photo upload failed: ${upErr.message}`;
      else avatarPath = path;
    }
  }

  if (me.contact_id) {
    await supabase
      .from("contacts")
      .update({
        phone: phone || null,
        address: finalAddress,
        ...(avatarPath ? { avatar_path: avatarPath } : {}),
        last_modified_by: "portal:settings",
      })
      .eq("id", me.contact_id);
  }

  revalidatePath("/my/settings");
  if (avatarErr) redirect(`/my/settings?error=${encodeURIComponent(avatarErr)}`);
  redirect(
    `/my/settings?saved=profile${verified === null ? "" : verified ? "&verified=1" : "&verified=0"}`,
  );
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

// Rename a home - RLS (can_edit_project) is the boundary.
export async function renameHome(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) redirect("/my/settings?error=" + encodeURIComponent("Give the home a name."));
  const { error } = await supabase
    .from("projects")
    .update({ project_name: name, last_modified_by: "portal:settings" })
    .eq("id", projectId);
  revalidatePath("/my/settings");
  revalidatePath("/my");
  redirect(error ? "/my/settings?error=" + encodeURIComponent(error.message) : "/my/settings?saved=1");
}
