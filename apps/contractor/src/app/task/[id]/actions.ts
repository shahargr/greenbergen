"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";

// Post a note on a task, close it, or both - then go back to the list the
// person came from. Every rule lives in the database: add_task_comment
// checks it is your project and not read-only; portal_close_task holds the
// photo gate and records an unlock reason against the task. This relays.

// The return path arrives on the URL, so it is untrusted input: only ever a
// path inside this app, never an absolute URL that could bounce someone off
// the site.
function safeBack(raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/tasks";
}

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

const to = (path: string, params: Record<string, string>) => {
  const p = new URLSearchParams(params);
  const q = p.toString();
  return q ? `${path}?${q}` : path;
};

// ONE SAVE FOR THE WHOLE TASK.
//
// Shahar (2026-09-12): "if i update multiple fields, and add a photo, and only
// save at the end, I am losing pretty much all the fields I updated. please
// make sure that save is applicable to all the fields I updated."
//
// He was right and it was the app's fault, not the database's. The screen had
// THREE forms - the edit drawer, the update box and the payment drawer - each
// with its own save button, and pressing the last one submitted only its own
// third of the screen and then navigated away. Everything typed in the other
// two went in the bin, silently.
//
// There is one form now and every button on it saves everything: the field
// changes, the note and its attachments, and - when the button pressed was the
// payment's - the payment too. Which button you used only decides what ELSE
// happens, never what gets saved.
//
//   save       the fields, and the note if there is one
//   complete   ...and close the task
//   payment    ...and log the purchase
//
// And it STAYS on the task afterwards ("after clicking save, you should stay
// on this very same line added, as sometime you would want to edit"), landing
// on the entry it just posted with an Undo beside it.
export async function saveTask(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = safeBack(formData.get("back"));
  const note = String(formData.get("note") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const intent = String(formData.get("do") ?? "save");
  // Choosing Completed in the Stage dropdown IS asking to close it, and it
  // goes the same way the button does - through portal_close_task, which asks
  // for the proof. The stage list may tell the truth without the gate moving.
  const stageComplete = String(formData.get("status") ?? "") === "Completed";
  const complete = intent === "complete" || (intent !== "payment" && stageComplete);
  const here = (extra: Record<string, string>, hash = "") =>
    `${to(`/task/${id}`, { back, ...extra })}${hash}`;
  if (!id) redirect(back);

  const fileIds = String(formData.get("file_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const supabase = await createClient();
  // What to tell them, in the order it happened.
  const said: string[] = [];
  let noteId = "";

  // 1. THE FIELDS. Only when the edit drawer was on the page - a crew member
  //    who may not edit never sends them, and portal_task_edit changes only
  //    what actually differs, so an untouched drawer is a no-op.
  if (String(formData.get("has_fields") ?? "") === "1") {
    const s = (k: string) => String(formData.get(k) ?? "").trim();
    const patch: Record<string, string> = {
      action: s("action"), desired_outcome: s("desired_outcome"),
      pending_on: s("pending_on"), pending_reason: s("pending_reason"),
      pending_category: s("pending_category"), priority: s("priority"),
      target_date: s("target_date"), assignee: s("assignee"),
    };
    // The stage goes in the patch UNLESS it is Completed: portal_task_edit
    // refuses that word (closing has a gate) and `complete` below takes it
    // through portal_close_task instead. The key is left out rather than
    // blanked - the function writes whatever it is handed, so an empty string
    // would set the status to an empty string.
    if (!stageComplete) patch.status = s("status");
    const { data, error } = await supabase.rpc("portal_task_edit", {
      p_action_id: id, p_patch: patch,
    });
    if (error) redirect(here({ error: error.message, edit: "1" }));
    if (data?.ok === false) redirect(here({ error: data.reason ?? "That change did not save.", edit: "1" }));
    const changed: string[] = Array.isArray(data?.changed) ? data.changed : [];
    if (changed.length) said.push(`Saved: ${changed.join(", ")}`);
  }

  // 2. THE ENTRY. A recording with no text IS a note (migration 037).
  if (note || fileIds.length > 0) {
    const { data, error } = await supabase.rpc("add_task_comment", {
      p_action_id: id, p_body: note || null, p_file_ids: fileIds.length > 0 ? fileIds : null,
    });
    if (error || data?.ok === false) {
      redirect(here({ error: data?.reason ?? error?.message ?? "That update did not save." }));
    }
    if (typeof data?.id === "string") noteId = data.id;
    said.push(fileIds.length > 0 && !note
      ? `Posted, with ${fileIds.length} attached`
      : "Update posted");
  }

  // 3. THE PURCHASE - whenever one has been filled in, whichever button was
  //    pressed. Shahar (2026-09-12): "when clicking update & close, this kills
  //    anything we did in the log a payment section as it is outside that
  //    section." It was true: only the payment's own button logged it. An
  //    amount typed in is a payment somebody means to record, so every Update
  //    records it. Nothing on this screen is lost by pressing the wrong save.
  const money = (v: FormDataEntryValue | null) => {
    const raw = String(v ?? "").replace(/[$,\s]/g, "");
    if (!raw) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const amount = money(formData.get("amount"));
  if (intent === "payment" || amount != null) {
    if (amount == null || amount <= 0) redirect(here({ error: "Enter what it cost.", money: "1" }));
    const payFiles = String(formData.get("payment_file_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    const { data, error } = await supabase.rpc("task_payment_log", {
      p_action: id,
      p_amount: amount,
      p_method: txt(formData.get("method")),
      p_payee_name: txt(formData.get("payee")),
      p_reference: txt(formData.get("reference")),
      p_paid_on: txt(formData.get("paid_on")),
      p_from_account: txt(formData.get("from_account")),
      p_notes: txt(formData.get("notes")),
      p_awaiting: String(formData.get("awaiting") ?? "") === "1",
      p_file_ids: payFiles.length > 0 ? payFiles : null,
    });
    // The fields and the comment above are already saved; say so with the
    // refusal, and reopen the drawer so the payment is where they left it.
    const kept = said.length ? `${said.join(" · ")} — but ` : "";
    if (error) redirect(here({ error: kept + error.message, money: "1" }));
    if (data?.ok === false) redirect(here({ error: kept + (data.reason ?? "that payment did not save."), money: "1" }));
    revalidatePath("/money");
    said.push(data?.awaiting
      ? `Logged — ${data?.paid_to ?? "they"} have a confirmation task open until it lands`
      : `Logged against this task, paid to ${data?.paid_to ?? "them"}`);
  }

  // 4. CLOSING, last, because everything above belongs on the task whether it
  //    closes or not.
  if (complete) {
    const { data, error } = await supabase.rpc("portal_close_task", {
      p_action_id: id, p_unlock_reason: reason || null,
    });
    if (error) redirect(here({ error: error.message }));
    if (data?.ok === false) {
      // These are not failures, they are the database asking for the one
      // thing it needs - and whatever else was saved above is already saved,
      // so say so alongside the ask.
      // NEEDS_PHOTO is the old name of NEEDS_EVIDENCE; a page deployed
      // before migration 074 may still be asking for it.
      const asking = data.code === "NEEDS_EVIDENCE" || data.code === "NEEDS_PHOTO" || data.code === "REASON_TOO_SHORT";
      redirect(here({
        error: data.reason ?? "That task did not close.",
        ...(said.length ? { ok: `${said.join(" · ")}.` } : {}),
        ...(asking ? { why: "1" } : {}),
      }));
    }
  }

  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath("/inbox");
  revalidatePath(`/task/${id}`);
  // Closing is the one thing that finishes with the task, so that is the one
  // time it goes back to the list.
  if (complete) redirect(back);
  redirect(here(
    { ok: said.length ? `${said.join(" · ")}.` : "Nothing changed.", ...(noteId ? { undo: noteId } : {}) },
    noteId ? `#n${noteId}` : "",
  ));
}

// UNDO THE LINE YOU JUST ADDED. The entry comes off the task; anything
// attached to it stays in the project's files, because the photograph was
// real even when the sentence was wrong (migration 073).
export async function undoNote(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const noteId = String(formData.get("note") ?? "");
  const back = safeBack(formData.get("back"));
  const here = (extra: Record<string, string>) => to(`/task/${id}`, { back, ...extra });
  if (!id || !noteId) redirect(back);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_task_note_delete", { p_id: noteId });
  if (error) redirect(here({ error: error.message }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That entry was not removed." }));
  revalidatePath(`/task/${id}`);
  revalidatePath("/inbox");
  redirect(here({ ok: "Taken back. Anything you attached stays on the project." }));
}

// CORRECT A PAYMENT (migration 073). Shahar: "inside a task, i cannot edit the
// transaction. it is status paid, however, it was refunded. where can we edit
// the transactions from?" - nowhere, until now. portal_transaction_edit holds
// every rule, including which states a person may set by hand; this shapes the
// form and stays on the task.
export async function editPayment(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const txn = String(formData.get("txn") ?? "");
  const back = safeBack(formData.get("back"));
  const here = (extra: Record<string, string>) => to(`/task/${id}`, { back, ...extra });
  if (!id || !txn) redirect(back);
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_transaction_edit", {
    p_id: txn,
    p_patch: {
      description: s("description"), amount: s("amount").replace(/[$,\s]/g, ""),
      paid_on: s("paid_on"), method: s("method"), reference: s("reference"),
      from_account: s("from_account"), payee: s("payee"), status: s("status"),
    },
  });
  if (error) redirect(here({ error: error.message, money: "1" }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That payment did not change.", money: "1" }));
  revalidatePath(`/task/${id}`);
  revalidatePath("/money");
  revalidatePath("/");
  const changed: string[] = Array.isArray(data?.changed) ? data.changed : [];
  redirect(here({ ok: changed.length ? `Payment updated: ${changed.join(", ")}.` : "Nothing changed on that payment." }));
}

// Change the task itself - subject, outcome, stage, who holds the ball,
// priority, date, assignee (migration 044). The form sends every field it
// shows; portal_task_edit changes only what differs and enforces the
// vocabulary, the pending-needs-a-reason rule and who may edit. Stays on
// the task afterwards, because you are usually not done with it.
export async function editTask(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = safeBack(formData.get("back"));
  const here = (extra: Record<string, string>) => to(`/task/${id}`, { back, ...extra });
  if (!id) redirect(back);
  const s = (k: string) => String(formData.get(k) ?? "").trim();
  const patch = {
    action: s("action"),
    desired_outcome: s("desired_outcome"),
    status: s("status"),
    pending_on: s("pending_on"),
    pending_reason: s("pending_reason"),
    pending_category: s("pending_category"),
    priority: s("priority"),
    target_date: s("target_date"),
    assignee: s("assignee"),
  };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_task_edit", { p_action_id: id, p_patch: patch });
  if (error) redirect(here({ error: error.message }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That change did not save.", edit: "1" }));
  revalidatePath("/tasks");
  revalidatePath("/inbox");
  revalidatePath(`/task/${id}`);
  const changed: string[] = Array.isArray(data?.changed) ? data.changed : [];
  redirect(here({ ok: changed.length ? `Saved: ${changed.join(", ")}.` : "Nothing changed." }));
}


// "This will not happen." The task stays as record with the reason on it,
// closed as Cancelled through close_action like every other closing
// (migration 060). Back to the list, since the task is done with.
export async function cancelTask(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = safeBack(formData.get("back"));
  const reason = String(formData.get("reason") ?? "").trim();
  const here = (extra: Record<string, string>) => to(`/task/${id}`, { back, ...extra });
  if (!id) redirect(back);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_task_cancel", { p_action_id: id, p_reason: reason || null });
  if (error) redirect(here({ error: error.message }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That task did not cancel." }));
  revalidatePath("/tasks");
  revalidatePath("/");
  revalidatePath(`/task/${id}`);
  redirect(back);
}

// "It was a mistake." Gone - but only a task nothing has been posted on,
// made by you or on a site you run; the database refuses the rest with the
// reason and points at Cancel.
export async function deleteTask(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const back = safeBack(formData.get("back"));
  const here = (extra: Record<string, string>) => to(`/task/${id}`, { back, ...extra });
  if (!id) redirect(back);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_task_delete", { p_action_id: id });
  if (error) redirect(here({ error: error.message }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That task was not deleted." }));
  revalidatePath("/tasks");
  revalidatePath("/");
  redirect(back);
}
