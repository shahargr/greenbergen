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
