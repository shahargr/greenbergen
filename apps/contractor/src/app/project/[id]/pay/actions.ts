"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";

// LOG A PAYMENT UNDER A CATEGORY.
//
// Shahar (2026-09-13): "build hierarchy so i can see everything Frame related
// (example the receipt i need to pay) and under each category allow me to log
// a payment."
//
// A payment still hangs off a TASK - that is where the receipt belongs, where
// the money ladder gates it and where anybody looks for it later. What the
// category adds is the shortlist: you arrive having already said "this is a
// framing cost", and the only thing left to choose is which piece of framing
// work it was. Every rule is task_payment_log's; this relays.

function safeBack(raw: FormDataEntryValue | null): string {
  const s = String(raw ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/";
}

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function logCategoryPayment(formData: FormData) {
  const back = safeBack(formData.get("back"));
  const here = safeBack(formData.get("here"));
  const action = String(formData.get("action_id") ?? "");
  const at = (extra: Record<string, string>) => {
    const [path, qs] = here.split("?");
    const p = new URLSearchParams(qs ?? "");
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${path}?${p.toString()}`;
  };
  if (!action) redirect(at({ error: "Choose which task this payment belongs to." }));

  const raw = String(formData.get("amount") ?? "").replace(/[$,\s]/g, "");
  const amount = raw ? Number(raw) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) redirect(at({ error: "Enter what it cost." }));

  const files = String(formData.get("payment_file_ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("task_payment_log", {
    p_action: action,
    p_amount: amount,
    p_method: txt(formData.get("method")),
    p_payee_name: txt(formData.get("payee")),
    p_reference: txt(formData.get("reference")),
    p_paid_on: txt(formData.get("paid_on")),
    p_from_account: txt(formData.get("from_account")),
    p_notes: txt(formData.get("notes")),
    p_awaiting: String(formData.get("awaiting") ?? "") === "1",
    p_file_ids: files.length > 0 ? files : null,
  });
  if (error) redirect(at({ error: error.message }));
  if (data?.ok === false) redirect(at({ error: data.reason ?? "That payment did not save." }));

  revalidatePath("/money");
  revalidatePath("/");
  revalidatePath(`/task/${action}`);
  // Back where the category was, with the money now on it - the whole point
  // of logging it from there rather than from inside the task.
  const [path, qs] = back.split("?");
  const p = new URLSearchParams(qs ?? "");
  p.set("ok", data?.awaiting
    ? `Logged — ${data?.paid_to ?? "they"} have a confirmation task open until it lands`
    : `Logged against the task, paid to ${data?.paid_to ?? "them"}`);
  redirect(`${path}?${p.toString()}`);
}
