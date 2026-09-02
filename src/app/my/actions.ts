"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/transcribe";

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
  const { error } = await supabase.rpc("set_home_town", { p_town: town });
  if (error) {
    redirect(`/my?panel=town&error=${encodeURIComponent(error.message)}`);
  }
  revalidatePath("/my");
  redirect("/my");
}

// Adds a job under the owner's home container (create_home_project with a
// parent), governed by the agreement like everything else. An optional voice
// note describing the project is stored in project-media and recorded on the
// new project through the file store.
export async function createJob(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const parentId = String(formData.get("parent") ?? "").trim();
  const audio = formData.get("audio");
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

  if (audio instanceof File && audio.size > 0 && data.project_id) {
    const ext = audio.type.includes("mp4") ? ".m4a" : ".webm";
    const path = `${data.project_id}/description-${Date.now()}${ext}`;
    const bytes = await audio.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("project-media")
      .upload(path, bytes, { contentType: audio.type || undefined, upsert: true });
    if (!upErr) {
      const { data: fileId } = await supabase.rpc("record_project_file", {
        p_project_id: data.project_id,
        p_path: path,
        p_file_name: `project-description${ext}`,
        p_mime: audio.type || null,
        p_size: audio.size,
        p_caption: "Project description (voice note)",
        p_kind: "audio",
      });
      // Transcription runs after the response is sent; if it works, the
      // text lands on the file's ai_metadata and in the project notes.
      const projectId = data.project_id as string;
      after(async () => {
        const t = await transcribeAudio(bytes, `project-description${ext}`, audio.type || null);
        if (!t.ok) return;
        if (fileId) {
          await supabase
            .from("files")
            .update({ ai_metadata: { transcript: t.text, transcribed_by: t.provider } })
            .eq("id", fileId);
        }
        const { data: proj } = await supabase.from("projects").select("notes").eq("id", projectId).maybeSingle();
        await supabase
          .from("projects")
          .update({
            notes: `${proj?.notes ? proj.notes + "\n\n" : ""}Voice note transcription:\n${t.text}`,
            last_modified_by: "portal:transcribe",
          })
          .eq("id", projectId);
      });
    }
    // A failed voice upload never blocks the project itself.
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

// Log an actual payment (PM and above; RLS on payment_log is the law -
// my_authority_rank(project) >= 50 gates both read and write).
export async function logPayment(formData: FormData) {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  const amount = Number(amountRaw);
  const back = "/my?panel=payment";

  if (!projectId) redirect(`${back}&error=${encodeURIComponent("Pick the project.")}`);
  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(`${back}&error=${encodeURIComponent("Enter the amount paid.")}`);
  }
  const paidTo = String(formData.get("paid_to") ?? "").trim();
  if (!paidTo) redirect(`${back}&error=${encodeURIComponent("Who was paid?")}`);
  const method = String(formData.get("method") ?? "");
  if (!method) redirect(`${back}&error=${encodeURIComponent("Pick the payment type.")}`);

  const { error } = await supabase.from("payment_log").insert({
    project_id: projectId,
    amount,
    paid_on: String(formData.get("paid_on") ?? "").trim() || new Date().toISOString().slice(0, 10),
    paid_by: String(formData.get("paid_by") ?? "").trim() || "—",
    paid_to: paidTo,
    paid_from_account: String(formData.get("paid_from") ?? "").trim() || null,
    payment_method_id: method,
    requested_by_trade: String(formData.get("trade") ?? "").trim() || null,
    contract_id: String(formData.get("contract") ?? "").trim() || null,
    notes: String(formData.get("notes") ?? "").trim() || null,
    last_modified_by: "portal:payment",
  });
  if (error) {
    const msg = error.message.includes("row-level security")
      ? "Logging payments on this project is not yours to do."
      : error.message;
    redirect(`${back}&error=${encodeURIComponent(msg)}`);
  }
  revalidatePath("/my");
  redirect(`${back}&ok=${encodeURIComponent("Payment logged ✓")}`);
}
