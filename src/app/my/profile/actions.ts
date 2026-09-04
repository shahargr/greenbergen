"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const back = (msg: string, isError = false, hash = "") =>
  `/my/profile?${isError ? "error" : "ok"}=${encodeURIComponent(msg)}${hash}`;

const txt = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

// Everything about you, in one save. Only the keys the form actually showed
// are sent, so a partial form never blanks a field it did not display.
export async function saveFullProfile(formData: FormData) {
  const supabase = await createClient();
  const payload: Record<string, string> = {};
  for (const k of ["full_name", "person_name", "title", "role_at_company", "phone", "phone_type",
                   "phone_2", "phone_2_type", "email_b", "address", "notes", "referral"]) {
    if (formData.has(k)) payload[k] = txt(formData, k);
  }
  const { error } = await supabase.rpc("portal_my_profile_save", { p: payload });
  revalidatePath("/my/profile");
  revalidatePath("/my/settings");
  redirect(error ? back(error.message, true) : back("Profile saved."));
}

// The trades you offer. Ticking none is allowed — you may not be a trade.
export async function saveMyTrades(formData: FormData) {
  const supabase = await createClient();
  const trades = formData.getAll("trade").map((v) => String(v));
  const { error } = await supabase.rpc("portal_my_trades_set", { p_trades: trades });
  revalidatePath("/my/profile");
  revalidatePath("/my/settings");
  redirect(error
    ? back(error.message, true, "#trades")
    : back(`${trades.length} trade${trades.length === 1 ? "" : "s"} saved.`, false, "#trades"));
}

// One licence or certificate, with the document itself when there is one.
// The file lands in the private credentials bucket under your own contact id;
// storage policy, not this code, is what keeps it yours.
export async function saveCredential(formData: FormData) {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  const contactId = me?.contact_id as string | undefined;
  if (!contactId) redirect(back("Your account has no contact record yet.", true, "#papers"));

  const file = formData.get("file");
  let bucket: string | null = null;
  let path: string | null = null;
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    if (file.size > 15 * 1024 * 1024) redirect(back("That file is over 15 MB.", true, "#papers"));
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    path = `${contactId}/${crypto.randomUUID()}${ext}`;
    const { error: upErr } = await supabase.storage.from("credentials")
      .upload(path, await file.arrayBuffer(), { contentType: file.type || undefined, upsert: false });
    if (upErr) redirect(back(`Upload refused: ${upErr.message}`, true, "#papers"));
    bucket = "credentials";
    fileName = file.name;
  }

  const { error } = await supabase.rpc("portal_credential_save", {
    p: {
      id: txt(formData, "id") || null,
      trade: txt(formData, "trade") || null,
      kind: txt(formData, "kind") || "license",
      label: txt(formData, "label"),
      number: txt(formData, "number") || null,
      issuer: txt(formData, "issuer") || null,
      issued_on: txt(formData, "issued_on") || null,
      expires_on: txt(formData, "expires_on") || null,
      notes: txt(formData, "notes") || null,
      bucket, path, file_name: fileName,
    },
  });
  revalidatePath("/my/profile");
  redirect(error ? back(error.message, true, "#papers") : back("Document saved.", false, "#papers"));
}

export async function deleteCredential(credentialId: string) {
  const supabase = await createClient();
  const { error } = await supabase.rpc("portal_credential_delete", { p_id: credentialId });
  revalidatePath("/my/profile");
  redirect(error ? back(error.message, true, "#papers") : back("Document removed.", false, "#papers"));
}
