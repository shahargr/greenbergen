"use server";

import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { friendly } from "../rpc";

// BRING SOMEONE ONTO GREEN BERGEN, from any door.
//
// Shahar: "admin / home owner / contractor: can invite home owner/resident and
// contractor. name, phone, email, invitation tag line are all optional."
//
// invite_peer has taken exactly that - a kind, and four optional fields -
// since the portal grew invitations. What was missing was one form that
// every door shows. This is its action; the homeowner app used to have its
// own copy with no phone field, and the expert app had nothing.
//
// The link comes back to the page that made it (`base`), to copy or share.
// Nobody joins until they open it, and the database decides the quota and
// the kind - this relays.
function base(formData: FormData): string {
  const s = String(formData.get("base") ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/settings";
}

export async function invitePerson(formData: FormData) {
  const b = base(formData);
  const kind = String(formData.get("kind") ?? "homeowner") === "contractor" ? "contractor" : "homeowner";
  const name = String(formData.get("name") ?? "").trim() || null;
  const phone = String(formData.get("phone") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("invite_peer", {
    p_kind: kind, p_email: email, p_name: name, p_note: note, p_minutes: null, p_quota: 1, p_phone: phone,
  });
  const sep = b.includes("?") ? "&" : "?";
  if (error || !data?.ok || !data?.token) {
    redirect(`${b}${sep}error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not make the link."))}`);
  }
  redirect(`${b}${sep}token=${encodeURIComponent(data.token)}&who=${encodeURIComponent(name ?? email ?? phone ?? (kind === "contractor" ? "your contractor" : "your neighbor"))}&kind=${kind}`);
}
