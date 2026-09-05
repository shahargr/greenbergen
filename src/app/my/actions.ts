"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { transcribeAudio } from "@/lib/transcribe";
import { geocodeUsAddress } from "@/lib/geocode";

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
    redirect(`/my/new-project?error=${encodeURIComponent("Give the project a name.")}`);
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_home_project", {
    p_name: name,
    p_description: description || null,
    p_parent_project_id: parentId,
  });
  if (error || !data?.ok) {
    redirect(`/my/new-project?error=${encodeURIComponent(data?.reason ?? "Could not create the project — try again.")}`);
  }

  if (audio instanceof File && audio.size > 0 && data.project_id) {
    const ext = audio.type.includes("mp4") ? ".m4a" : ".webm";
    const path = `${data.project_id}/description-${Date.now()}${ext}`;
    const bytes = await audio.arrayBuffer();
    after(async () => {
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
    });
    // A failed voice upload never blocks the project itself.
  }

  // Photos, plans and PDFs describing the project - uploaded after the
  // response so creation never waits on them.
  const jobPhotos = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  const jobDocs = formData.getAll("docs").filter((f): f is File => f instanceof File && f.size > 0);
  if (data.project_id && (jobPhotos.length || jobDocs.length)) {
    const newProjectId = data.project_id as string;
    after(async () => {
      for (const [i, file] of [...jobPhotos, ...jobDocs].entries()) {
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
        const ext2 = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? (isImage ? ".jpg" : ".pdf")).toLowerCase();
        const fpath = `${newProjectId}/description-files/${Date.now()}-${i}${ext2}`;
        const fbytes = await file.arrayBuffer();
        const { error: fErr } = await supabase.storage
          .from("project-media")
          .upload(fpath, fbytes, { contentType: file.type || undefined, upsert: true });
        if (!fErr) {
          await supabase.rpc("record_project_file", {
            p_project_id: newProjectId,
            p_path: fpath,
            p_file_name: file.name || `project-file${ext2}`,
            p_mime: file.type || null,
            p_size: file.size,
            p_caption: `Project description (${isPdf ? "document" : "photo"})`,
            p_kind: isImage ? "photo" : isPdf ? "document" : "other",
          });
        }
      }
    });
  }

  // Wizard answers become structured config values on the new project.
  const cfg: { key: string; value: string }[] = [];
  const cfgLabels: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v !== "string") continue;
    if (k.startsWith("cfglabel_")) { cfgLabels[k.slice(9)] = v; continue; }
    if (k.startsWith("cfg_") && v.trim()) cfg.push({ key: k.slice(4), value: v.trim() });
  }
  if (cfg.length && data.project_id) {
    const cfgProjectId = data.project_id as string;
    after(async () => {
      await supabase.from("project_config_values").upsert(
        cfg.map((c) => ({
          project_id: cfgProjectId,
          key: c.key,
          label: cfgLabels[c.key] ?? c.key.replace(/_/g, " "),
          value: c.value,
          updated_by: "portal:new-project wizard",
        })),
        { onConflict: "project_id,key" }
      );
    });
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
  // The row's contact is the PAYEE (who got paid), never the requester — the
  // requester lives only in the description suffix. Match "Paid to" against
  // people on this project (exact, case-insensitive); no match = no contact.
  const { data: payeeRows } = await supabase
    .from("project_members")
    .select("contact_id, contacts(name, person_name)")
    .eq("project_id", projectId)
    .eq("status", "active")
    .not("contact_id", "is", null);
  const want = paidTo.toLowerCase();
  const payeeId = (((payeeRows ?? []) as unknown as { contact_id: string; contacts: { name: string | null; person_name: string | null } | null }[]))
    .find((m) => [m.contacts?.person_name, m.contacts?.name].some((n) => (n ?? "").trim().toLowerCase() === want))
    ?.contact_id ?? null;
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
    contractor_id: payeeId,
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
  redirect(`${back}ok=${encodeURIComponent("Transaction logged ✓")}`);
}

// Edit a logged payment - fields plus late-arriving receipts. The ledger
// row's RLS (can_see_money_on) decides who may.
export async function editPayment(formData: FormData) {
  const supabase = await createClient();
  const txId = String(formData.get("tx") ?? "");
  // Return to where the edit was made: the homepage card passes back="/my".
  // Only known in-app paths are honored (no open redirect).
  const back = (formData.get("back") === "/my" ? "/my" : "/my/payments") + "?";
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
  const status = String(formData.get("status") ?? "").trim();
  if (status) {
    const { data: ok } = await supabase.from("transaction_statuses").select("status").eq("status", status).maybeSingle();
    if (ok) updates.status = status;
  }

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
// Create-and-assign. The task row is made here; the photos and voice note
// are NOT in this request. Vercel caps a serverless request body at 4.5 MB
// and rejects anything larger before this code runs - no log line, and the
// browser sees only "An unexpected response was received from the server".
// One phone photo plus a voice note clears that. So the form uploads its
// files straight to Supabase Storage (the storage policy admits a project
// editor, the same rule this action ran under) and then calls
// attachTaskUploads with the paths. Returns the new task's id.
export type TaskCreated = { ok: true; id: string } | { ok: false; error: string };

export async function createTask(formData: FormData): Promise<TaskCreated> {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!projectId || !title) return { ok: false, error: "Project and task title are both needed." };
  const assignee = String(formData.get("assigned_to") ?? "").trim() || null;
  const priority = String(formData.get("priority") ?? "Medium");
  // Retroactive logging: a task can be created straight into a completed
  // state (a project opened late, where the work is already done).
  const done = formData.get("done") != null;
  const { data: me } = await supabase.rpc("me");

  // Since v104 the assigned_to / assigned_by NAME columns hold personas
  // only - real people are recorded through the *_contact_id columns.
  const { data: created, error } = await supabase
    .from("actions")
    .insert({
      action: title,
      domain: "construction",
      status: done ? "Completed" : "Not Started",
      priority: ["No Priority", "Low", "Medium", "High"].includes(priority) ? priority : "Medium",
      target_date: String(formData.get("target_date") ?? "").trim() || null,
      last_updated: done ? new Date().toISOString() : null,
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
    return {
      ok: false,
      error: error?.message.includes("row-level security")
        ? "Creating tasks on this project is not yours to do."
        : error?.message ?? "Could not create the task.",
    };
  }
  revalidatePath("/my");
  revalidatePath(`/my/project/${projectId}`);
  return { ok: true, id: created.id };
}

// The second half of creating a task with attachments: the browser has put
// the files in Storage under this project and task; this records each one
// and links it to the task as reference material. The path prefix is checked
// so a caller cannot record a file that belongs to another project.
export type TaskUpload = { path: string; name: string; mime: string; size: number; kind: "photo" | "audio" | "document" | "other" };

export async function attachTaskUploads(taskId: string, projectId: string, title: string, uploads: TaskUpload[]) {
  const supabase = await createClient();
  const prefix = `${projectId}/actions/${taskId}/`;
  const failed: string[] = [];
  for (const u of uploads) {
    if (!u.path.startsWith(prefix)) { failed.push(u.name); continue; }
    const { data: fileId, error } = await supabase.rpc("record_project_file", {
      p_project_id: projectId,
      p_path: u.path,
      p_file_name: u.name,
      p_mime: u.mime || null,
      p_size: u.size,
      p_caption: `Task instructions: ${title}`,
      p_kind: u.kind,
    });
    if (error || !fileId) { failed.push(`${u.name}${error ? ` (${error.message})` : ""}`); continue; }
    const { data: att } = await supabase.rpc("file_attach", {
      p_file_id: fileId,
      p_action_id: taskId,
      p_contract_id: null,
      p_role: "reference",
    });
    if (att && att.ok === false) failed.push(`${u.name} (${att.reason})`);
  }
  revalidatePath(`/my/task/${taskId}`);
  return { ok: failed.length === 0, failed };
}


// Append a timestamped comment to a payment's notes.
export async function commentPayment(formData: FormData) {
  const supabase = await createClient();
  const txId = String(formData.get("tx") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  const back = "/my/payments?";
  if (!txId || !text) redirect(`${back}error=${encodeURIComponent("Write the comment first.")}`);

  const [{ data: tx }, { data: me }] = await Promise.all([
    supabase.from("transactions").select("id, notes").eq("id", txId).maybeSingle(),
    supabase.rpc("me"),
  ]);
  if (!tx) redirect(`${back}error=${encodeURIComponent("That payment is not yours to comment on.")}`);

  const stamp = new Date().toISOString().slice(0, 10);
  const who = me?.full_name ?? me?.email ?? "someone";
  const { error } = await supabase
    .from("transactions")
    .update({
      notes: `${tx.notes ? tx.notes + "\n" : ""}[${stamp} ${who}] ${text}`,
      last_modified_by: "portal:payment",
    })
    .eq("id", txId);
  revalidatePath("/my/payments");
  redirect(error ? `${back}error=${encodeURIComponent(error.message)}` : `${back}ok=${encodeURIComponent("Comment added ✓")}`);
}

// The quota line self-serves: the first extension is granted on the spot
// (agreement raised to 2 homes, logged); beyond 2 files a request with
// the office and emails admin.
export async function requestMoreHomes() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_additional_home");
  if (error || !data?.ok) {
    redirect(`/my?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not process the request.")}`);
  }
  if (!data.granted) {
    try {
      const { sendMail } = await import("@/lib/mailer");
      const { data: me } = await supabase.rpc("me");
      if (process.env.MAIL_ADMIN) {
        await sendMail(
          process.env.MAIL_ADMIN,
          `Agreement extension request — ${me?.full_name ?? me?.email}`,
          `${me?.full_name ?? me?.email} asked to manage more than 2 homes.
Handle it in the portal task queue (system domain).`
        );
      }
    } catch {
      // The task is the record; a failed email never blocks the request.
    }
    revalidatePath("/my");
    redirect(`/my?ok=${encodeURIComponent("Request sent — we'll get back to you about additional homes.")}`);
  }
  revalidatePath("/my");
  redirect(`/my?ok=${encodeURIComponent("Done — your agreement now covers 2 homes. Claim the next address from Settings.")}`);
}

// Answer a project invitation addressed to me: accept seats me on the
// project, decline just records it. Either way the inviter sees the answer
// on their home page.
export async function respondInvite(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("id") ?? "");
  const accept = String(formData.get("accept") ?? "") === "1";
  const { data, error } = await supabase.rpc("portal_invite_respond", { p_id: id, p_accept: accept });
  revalidatePath("/my");
  if (error || !data?.ok) redirect(`/my?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not answer the invitation.")}`);
  redirect(accept ? `/my/project/${data.project_id}` : `/my?ok=${encodeURIComponent("Invitation declined.")}`);
}

// The inviter has seen an accept / decline notice.
export async function dismissInviteOutcome(formData: FormData) {
  const supabase = await createClient();
  await supabase.rpc("portal_invite_outcome_seen", { p_id: String(formData.get("id") ?? "") });
  revalidatePath("/my");
  redirect("/my");
}

// Clustered deal: sign up with a house and a date window. The address is
// geocoded so the system can tell which signups are genuinely neighbours;
// without coordinates the database falls back to matching the street name.
export async function joinClusterDeal(formData: FormData) {
  const supabase = await createClient();
  const promotionId = String(formData.get("promotion") ?? "");
  const projectId = String(formData.get("project") ?? "").trim() || null;
  let address = String(formData.get("address") ?? "").trim() || null;
  const back = "/my?panel=deals";
  if (!promotionId) redirect(`${back}&error=${encodeURIComponent("Which deal?")}`);
  if (formData.get("consent") !== "on") {
    redirect(`${back}&error=${encodeURIComponent("Please tick the box — it says what you are agreeing to.")}`);
  }
  if (projectId && !address) {
    const { data: p } = await supabase.from("projects").select("address").eq("id", projectId).maybeSingle();
    address = p?.address ?? null;
  }
  if (!address) redirect(`${back}&error=${encodeURIComponent("Tell us which house this is for.")}`);
  const geo = await geocodeUsAddress(address);
  const { data, error } = await supabase.rpc("deal_cluster_signup", {
    p_promotion: promotionId,
    p_project: projectId,
    p_address: geo?.matched ?? address,
    p_lat: geo?.lat ?? null,
    p_lng: geo?.lng ?? null,
    p_window_start: String(formData.get("window_start") ?? "").trim() || null,
    p_window_end: String(formData.get("window_end") ?? "").trim() || null,
    p_note: String(formData.get("note") ?? "").trim() || null,
  });
  revalidatePath("/my");
  if (error || !data?.ok) redirect(`${back}&error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not sign you up.")}`);
  const tier = data.tier as { label: string | null; price_cents: number } | null;
  const msg = `You're in — ${data.houses} house${data.houses === 1 ? "" : "s"} in your run so far` +
    (tier ? `, quoted at $${(tier.price_cents / 100).toLocaleString()} (${tier.label ?? "tier"})` : "") +
    `. Price is final when the run locks; it only goes down from list.`;
  redirect(`${back}&ok=${encodeURIComponent(msg)}`);
}

export async function leaveClusterDeal(promotionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("deal_withdraw", { p_promotion: promotionId });
  revalidatePath("/my");
  redirect(error || !data?.ok
    ? `/my?panel=deals&error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not withdraw.")}`
    : `/my?panel=deals&ok=${encodeURIComponent("You're out — no charge, your neighbours' quote was recomputed.")}`);
}

// Flag (or unflag) a project as a priority for ME: its tile floats to the
// top of my home page. Purely personal - RLS on user_project_prefs keeps it
// to the caller's own rows and the project is untouched.
export async function setProjectPriority(formData: FormData) {
  const supabase = await createClient();
  const projectId = String(formData.get("project") ?? "");
  const on = String(formData.get("on") ?? "") === "1";
  const back = String(formData.get("back") ?? "/my");
  const safeBack = /^\/my(\?[a-z0-9=&]*)?$/i.test(back) ? back : "/my";
  const { data: me } = await supabase.rpc("me");
  if (!projectId || !me?.app_user_id) redirect(safeBack);
  await supabase.from("user_project_prefs").upsert(
    { app_user_id: me.app_user_id, project_id: projectId, is_priority: on, updated_at: new Date().toISOString() },
    { onConflict: "app_user_id,project_id" },
  );
  revalidatePath("/my");
  redirect(safeBack);
}
