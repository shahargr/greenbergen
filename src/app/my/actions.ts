"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Adds a home: create_home_asset() writes the real-estate asset and its
// container project together, governed by the customer agreement (v103+).
// Runs as the signed-in user, so RLS and the agreement decide - never a
// service key.
export async function createHome(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  if (!name || !address) {
    redirect(`/my?error=${encodeURIComponent("Name and address are both needed.")}`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_home_asset", {
    p_name: name,
    p_address: address,
  });
  if (error) {
    redirect(`/my?error=${encodeURIComponent("Could not create the home — please try again.")}`);
  }
  if (!data?.ok) {
    redirect(`/my?error=${encodeURIComponent(data?.reason ?? "Could not create the home.")}`);
  }

  revalidatePath("/my");
  redirect("/my");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

// Sets the town that powers weather, trash days and local support - the
// small first commitment a brand-new owner can make before claiming a home.
export async function setTown(formData: FormData) {
  const town = String(formData.get("town") ?? "").trim();
  if (!town) redirect("/my?panel=town");
  const supabase = await createClient();
  await supabase.rpc("set_home_town", { p_town: town });
  revalidatePath("/my");
  redirect("/my");
}

// Adds a job under the owner's home container (create_home_project with a
// parent), governed by the agreement like everything else.
export async function createJob(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const parentId = String(formData.get("parent") ?? "").trim();
  if (!name || !parentId) {
    redirect(`/my?panel=addproject&error=${encodeURIComponent("Give the project a name.")}`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_home_project", {
    p_name: name,
    p_description: description || null,
    p_parent_project_id: parentId,
  });
  if (error || !data?.ok) {
    redirect(`/my?panel=addproject&error=${encodeURIComponent(data?.reason ?? "Could not create the project — try again.")}`);
  }
  revalidatePath("/my");
  redirect("/my");
}

// Join or leave a neighborhood deal.
export async function toggleDeal(promotionId: string, join: boolean) {
  const supabase = await createClient();
  await supabase.rpc("join_promotion", {
    p_promotion_id: promotionId,
    p_join: join,
    p_note: null,
  });
  revalidatePath("/my");
  redirect("/my?panel=deals");
}
