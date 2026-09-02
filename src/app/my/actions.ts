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

// Log an actual payment into the ONE finance ledger - transactions.
// RLS (can_see_money_on) is the boundary; the row lands as a paid,
// outgoing transaction. Requested-by becomes the ledger's contractor
// attribution; receipt photos and a voice note are stored in the file
// store, captioned with the payment.
export async function logPayment(formData: FormData) {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const amountRaw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  const amount = Number(amountRaw);
  const back = "/my/payments?";

  if (!projectId) redirect(`${back}error=${encodeURIComponent("Pick the project.")}`);
  if (!Number.isFinite(amount) || amount <= 0) {
    redirect(`${back}error=${encodeURIComponent("Enter the amount paid.")}`);
  }
  const paidTo = String(formData.get("paid_to") ?? "").trim();
  if (!paidTo) redirect(`${back}error=${encodeURIComponent("Who was paid?")}`);
  const method = String(formData.get("method") ?? "");
  if (!method) redirect(`${back}error=${encodeURIComponent("Pick the payment type.")}`);

  const requestedBy = String(formData.get("requested_by") ?? "").trim() || null;
  const [{ data: methodRow }, { data: requesterRow }] = await Promise.all([
    supabase.from("payment_methods").select("name").eq("id", method).maybeSingle(),
    requestedBy
      ? supabase.from("contacts").select("id, name, person_name").eq("id", requestedBy).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const requesterName = requesterRow ? (requesterRow.person_name ?? requesterRow.name) : null;
  const paidBy = String(formData.get("paid_by") ?? "").trim();
  const extraNotes = String(formData.get("notes") ?? "").trim();
  const paidOn = String(formData.get("paid_on") ?? "").trim() || new Date().toISOString().slice(0, 10);

  const { data: txRow, error } = await supabase.from("transactions").insert({
    description: `Payment to ${paidTo}${requesterName ? ` — requested by ${requesterName}` : ""}`,
    amount,
    direction: "out",
    status: "paid",
    paid_on: paidOn,
    paid_via: methodRow?.name ?? null,
    payment_method_id: method,
    paid_from_account: String(formData.get("paid_from") ?? "").trim() || null,
    project_id: projectId,
    contract_id: String(formData.get("contract") ?? "").trim() || null,
    contractor_id: requesterRow?.id ?? null,
    payment_reference: String(formData.get("payment_ref") ?? "").trim() || null,
    notes: [paidBy ? `Paid by: ${paidBy}.` : null, extraNotes || null].filter(Boolean).join(" ") || null,
    created_by: "portal:payment",
    last_modified_by: "portal:payment",
  }).select("id").maybeSingle();
  if (error || !txRow) {
    const msg = error?.message.includes("row-level security")
      ? "Logging payments on this project is not yours to do."
      : error?.message ?? "Could not log the payment.";
    redirect(`${back}error=${encodeURIComponent(msg)}`);
  }
  const txId = txRow.id as string;

  // Receipts: photos and voice into the project file store, captioned with
  // the payment - AFTER the response is sent, so the button never waits on
  // uploads. A failed upload never unwinds the ledger row.
  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const videos = formData.getAll("videos").filter((f): f is File => f instanceof File && f.size > 0);
  after(async () => {
  for (const [i, file] of [...photos, ...videos, ...files].entries()) {
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : isVideo ? ".mp4" : ".m4a")).toLowerCase();
    const path = `${projectId}/payments/${txId}/${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("project-media")
      .upload(path, bytes, { contentType: file.type || undefined, upsert: true });
    if (!upErr) {
      await supabase.rpc("record_project_file", {
        p_project_id: projectId,
        p_path: path,
        p_file_name: file.name || `payment${ext}`,
        p_mime: file.type || null,
        p_size: file.size,
        p_caption: `Payment: $${amount.toLocaleString()} to ${paidTo} (${paidOn})`,
        p_kind: isImage ? "photo" : isVideo ? "video" : "audio",
      });
    }
  }
  });

  revalidatePath("/my");
  redirect(`${back}ok=${encodeURIComponent("Payment logged ✓")}`);
}

// Edit a logged payment - fields plus late-arriving receipts. The ledger
// row's RLS (can_see_money_on) decides who may.
export async function editPayment(formData: FormData) {
  const supabase = await createClient();
  const txId = String(formData.get("tx") ?? "");
  const back = "/my/payments?";
  if (!txId) redirect(`${back}error=${encodeURIComponent("Missing payment id.")}`);

  const { data: tx } = await supabase
    .from("transactions")
    .select("id, project_id, description")
    .eq("id", txId)
    .maybeSingle();
  if (!tx) redirect(`${back}error=${encodeURIComponent("That payment is not yours to edit.")}`);

  const updates: Record<string, unknown> = { last_modified_by: "portal:payment" };
  const amountRaw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  if (amountRaw) {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      redirect(`${back}error=${encodeURIComponent("Bad amount.")}`);
    }
    updates.amount = amount;
  }
  const paidOn = String(formData.get("paid_on") ?? "").trim();
  if (paidOn) updates.paid_on = paidOn;
  const paidTo = String(formData.get("paid_to") ?? "").trim();
  if (paidTo) {
    const suffix = (tx.description ?? "").match(/ — requested by .*$/)?.[0] ?? "";
    updates.description = `Payment to ${paidTo}${suffix}`;
  }
  const paidFrom = String(formData.get("paid_from") ?? "").trim();
  if (formData.has("paid_from")) updates.paid_from_account = paidFrom || null;
  const method = String(formData.get("method") ?? "").trim();
  if (method) {
    const { data: methodRow } = await supabase.from("payment_methods").select("name").eq("id", method).maybeSingle();
    updates.payment_method_id = method;
    updates.paid_via = methodRow?.name ?? null;
  }
  if (formData.has("notes")) updates.notes = String(formData.get("notes") ?? "").trim() || null;

  const { error } = await supabase.from("transactions").update(updates).eq("id", txId);
  if (error) redirect(`${back}error=${encodeURIComponent(error.message)}`);

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  after(async () => {
  for (const [i, file] of [...photos, ...files].entries()) {
    const isImage = file.type.startsWith("image/");
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : ".m4a")).toLowerCase();
    const path = `${tx.project_id}/payments/${txId}/${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("project-media")
      .upload(path, bytes, { contentType: file.type || undefined, upsert: true });
    if (!upErr) {
      await supabase.rpc("record_project_file", {
        p_project_id: tx.project_id,
        p_path: path,
        p_file_name: file.name || `payment${ext}`,
        p_mime: file.type || null,
        p_size: file.size,
        p_caption: `Receipt for: ${paidTo ? `Payment to ${paidTo}` : tx.description ?? "payment"}`,
        p_kind: isImage ? "photo" : "audio",
      });
    }
  }
  });
  revalidatePath("/my");
  redirect(`${back}ok=${encodeURIComponent("Payment updated ✓")}`);
}

// Create and assign a task, with photos and a voice note attached as
// instructions (file_links role 'reference'). Members insert under the
// actions RLS; attachments never block the task.
export async function createTask(formData: FormData) {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const back = "/my/tasks?";
  if (!projectId || !title) {
    redirect(`${back}error=${encodeURIComponent("Project and task title are both needed.")}`);
  }
  const assignee = String(formData.get("assigned_to") ?? "").trim() || null;
  const priority = String(formData.get("priority") ?? "Medium");
  const { data: me } = await supabase.rpc("me");

  // Since v104 the assigned_to / assigned_by NAME columns hold personas
  // only - real people are recorded through the *_contact_id columns.
  const { data: created, error } = await supabase
    .from("actions")
    .insert({
      action: title,
      domain: "construction",
      status: "Not Started",
      priority: ["No Priority", "Low", "Medium", "High"].includes(priority) ? priority : "Medium",
      target_date: String(formData.get("target_date") ?? "").trim() || null,
      project_id: projectId,
      assigned_to_contact_id: assignee,
      assigned_by_contact_id: me?.contact_id ?? null,
      notes: String(formData.get("notes") ?? "").trim() || null,
      source: "side_interface",
      created_by: "portal:addtask",
      last_modified_by: "portal:addtask",
    })
    .select("id")
    .maybeSingle();
  if (error || !created) {
    const msg = error?.message.includes("row-level security")
      ? "Creating tasks on this project is not yours to do."
      : error?.message ?? "Could not create the task.";
    redirect(`${back}error=${encodeURIComponent(msg)}`);
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const taskId = created.id;
  after(async () => {
  for (const [i, file] of [...photos, ...files].entries()) {
    const isImage = file.type.startsWith("image/");
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : ".m4a")).toLowerCase();
    const path = `${projectId}/actions/${taskId}/instructions-${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { error: upErr } = await supabase.storage
      .from("project-media")
      .upload(path, bytes, { contentType: file.type || undefined, upsert: true });
    if (!upErr) {
      const { data: fileId } = await supabase.rpc("record_project_file", {
        p_project_id: projectId,
        p_path: path,
        p_file_name: file.name || `instructions${ext}`,
        p_mime: file.type || null,
        p_size: file.size,
        p_caption: `Task instructions: ${title}`,
        p_kind: isImage ? "photo" : "audio",
      });
      if (fileId) {
        await supabase.rpc("file_attach", {
          p_file_id: fileId,
          p_action_id: taskId,
          p_contract_id: null,
          p_role: "reference",
        });
      }
    }
  }
  });
  revalidatePath("/my");
  redirect(`/my/task/${taskId}?saved=1`);
}
