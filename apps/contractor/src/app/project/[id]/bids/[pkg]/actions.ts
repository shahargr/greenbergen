"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// The bid room, from the site. Every write here is a database function that
// owns its own rule - put somebody in the room, write the scope, take a
// number down, run a negotiation round, close one as lost, award it, and
// invite somebody already on the project. Nothing in this file decides
// anything.

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

const here = (projectId: string, pkgId: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `/project/${projectId}/bids/${pkgId}${q ? `?${q}` : ""}`;
};

// A number from a bidder, taken down by whoever runs the site - on the
// phone, standing where the walk just happened.
//
// portal_bid_reply reads the package's REQUIRED lines out of the reply to
// decide whether it is like for like, so a reply with no lines at all reads
// as every required line missing. The form therefore sends one entry per
// line, ticked by default: what the bidder did not include is what you
// untick, and the gaps the database computes are then true.
export async function recordReply(projectId: string, pkgId: string, bidId: string, formData: FormData) {
  const supabase = await createClient();
  const itemIds = String(formData.get("items") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const lineItems = itemIds.map((id) => ({
    scope_item_id: id,
    included: formData.get(`inc_${id}`) === "on",
    price: null as number | null,
  }));
  const amount = num(formData.get("amount"));
  if (amount == null) redirect(here(projectId, pkgId, { error: "Put their number in first." }));

  const { data, error } = await supabase.rpc("portal_bid_reply", {
    p_bid: bidId, p_line_items: lineItems, p_terms_reply: {}, p_insurance_reply: {},
    p_amount: amount, p_valid_until: txt(formData.get("valid_until")), p_notes: txt(formData.get("notes")),
  });
  revalidatePath(here(projectId, pkgId));
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "That number did not save.") }));
  }
  redirect(here(projectId, pkgId, { ok: data.like_for_like ? "reply" : "gaps" }));
}

// One round of the negotiation (help topic contractors): round one is the
// open ask, round two is best and final. The amount is optional - a
// contractor who holds his price has still been asked.
export async function negotiate(projectId: string, pkgId: string, bidId: string, formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_negotiate", {
    p_bid: bidId, p_amount: num(formData.get("amount")), p_note: txt(formData.get("note")),
  });
  revalidatePath(here(projectId, pkgId));
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "Could not record that round.") }));
  }
  redirect(here(projectId, pkgId, { ok: "round" }));
}

// Award. The database marks the winner, marks the rest, and closes the
// package; the contract is a later step.
export async function award(projectId: string, pkgId: string, bidId: string, formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_award", {
    p_pkg: pkgId, p_bid: bidId, p_reason: txt(formData.get("reason")),
  });
  revalidatePath(here(projectId, pkgId));
  revalidatePath(`/project/${projectId}`);
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "Could not award it.") }));
  }
  redirect(here(projectId, pkgId, { ok: "award" }));
}

// SOMEBODY NEW IN THE ROOM. Shahar met Diego about roofing this morning:
// Diego is in nothing, his firm is in nothing, and typing him into a contacts
// screen first is a step nobody takes standing in a driveway. Company first,
// person named (his choice, 2026-09-17) - portal_bid_room_add creates
// whichever half is new, joins a second person to the firm's existing row
// rather than opening a second bid, and remembers the trade against him.
export async function addToRoom(projectId: string, pkgId: string, formData: FormData) {
  const company = txt(formData.get("company_name"));
  const person = txt(formData.get("person_name"));
  if (!company && !person) redirect(here(projectId, pkgId, { error: "Say who — a company, or a name and a number." }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_room_add", {
    p_package: pkgId, p_company: null, p_contact: null,
    p_company_name: company, p_person_name: person,
    p_phone: txt(formData.get("phone")), p_email: txt(formData.get("email")),
  });
  revalidatePath(here(projectId, pkgId));
  revalidatePath(`/project/${projectId}/bids`);
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "Could not put them in the room.") }));
  }
  redirect(here(projectId, pkgId, { ok: data.existed ? "already" : "added" }));
}

// THE SCOPE, WRITTEN IN THE ROOM. One line per line: these become the
// project's scope for the trade and the rows every bid is judged against.
// The box IS the list (migration 180) - a line taken out stops being a row
// of this package, though it stays on the job, and a line a bidder already
// priced is held rather than dropped. A line already written is matched, not
// written twice, so saving the box back unchanged does nothing.
export async function setScope(projectId: string, pkgId: string, formData: FormData) {
  const kind = String(formData.get("kind") ?? "base") === "option" ? "option" : "base";
  const lines = String(formData.get("lines") ?? "")
    .split("\n").map((s) => s.replace(/^[-*•\s]+/, "").trim()).filter(Boolean);
  if (lines.length === 0) redirect(here(projectId, pkgId, { error: "Write at least one line." }));

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_scope_set", { p_package: pkgId, p_lines: lines, p_kind: kind });
  revalidatePath(here(projectId, pkgId));
  revalidatePath(`/project/${projectId}/bids`);
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "Those lines did not save.") }));
  }
  const held = Array.isArray(data.held) ? (data.held as string[]) : [];
  if (held.length > 0) redirect(here(projectId, pkgId, { ok: "scope", held: held.join(", ") }));
  redirect(here(projectId, pkgId, { ok: kind === "option" ? "options" : "scope" }));
}

// OUT, WITHOUT ANYBODY WINNING. A bidder drops out, or never comes back with
// a number, long before the winner is picked.
export async function markLost(projectId: string, pkgId: string, bidId: string, formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_lost", {
    p_bid: bidId, p_reason: txt(formData.get("reason")),
  });
  revalidatePath(here(projectId, pkgId));
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "Could not close that one.") }));
  }
  redirect(here(projectId, pkgId, { ok: "lost" }));
}

export async function invite(projectId: string, pkgId: string, formData: FormData) {
  const supabase = await createClient();
  const contacts = formData.getAll("contact").map(String);
  if (contacts.length === 0) redirect(here(projectId, pkgId, { error: "Pick at least one person." }));
  const { data, error } = await supabase.rpc("portal_bid_invite", { p_pkg: pkgId, p_contacts: contacts });
  revalidatePath(here(projectId, pkgId));
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? friendly(error?.message, "Could not invite them.") }));
  }
  redirect(here(projectId, pkgId, { ok: "invited" }));
}

// THE LINK WENT OUT. Recording it is a separate act from making it: you can
// copy a link and never send it, and the room should not claim otherwise.
export async function markLinkSent(projectId: string, pkgId: string, bidId: string, how: string) {
  const supabase = await createClient();
  await supabase.rpc("portal_bid_link_sent", { p_bid: bidId, p_how: how });
  revalidatePath(here(projectId, pkgId));
}

// A link that reached the wrong person, or a bidder who is out: kill it. The
// next one minted is a different uuid, so the old text stops working.
export async function revokeLink(projectId: string, pkgId: string, bidId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_link", { p_bid: bidId, p_revoke: true });
  revalidatePath(here(projectId, pkgId));
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? "Could not stop that link." }));
  }
  redirect(here(projectId, pkgId, { ok: "revoked" }));
}

// THE PHOTOGRAPH A BIDDER SEES BEFORE HE PRICES (Shahar, 2026-09-17). The
// job's photographs are private and he has no session, so a picked one is
// COPIED into the public bucket - the same wall and the same answer as the
// house pages (183). Copy first, record second: a copy with no row is a stray
// file nobody sees, a row with no copy is a broken picture in front of the
// man you want a price from.
export async function showPhoto(projectId: string, pkgId: string, formData: FormData) {
  const fileId = txt(formData.get("file_id"));
  const bucket = txt(formData.get("bucket")) ?? "project-media";
  const path = txt(formData.get("path"));
  if (!fileId || !path) redirect(here(projectId, pkgId, { error: "Pick a photograph first." }));

  const supabase = await createClient();
  const { data: dest, error: pathErr } = await supabase.rpc("bid_photo_path", { p_package: pkgId, p_file: fileId });
  if (pathErr || !dest) redirect(here(projectId, pkgId, { error: "That photograph has nowhere to go." }));

  const copy = await supabase.storage.from(bucket).copy(path, dest as string, { destinationBucket: "public-media" });
  if (copy.error && !/exist/i.test(copy.error.message ?? "")) {
    redirect(here(projectId, pkgId, { error: `Could not show that photograph: ${copy.error.message}` }));
  }

  const { data, error } = await supabase.rpc("portal_bid_photo_add", {
    p_package: pkgId, p_file: fileId, p_public_path: dest as string, p_caption: txt(formData.get("caption")),
  });
  revalidatePath(here(projectId, pkgId));
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? "That photograph did not go up." }));
  }
  redirect(here(projectId, pkgId, { ok: "photo" }));
}

export async function hidePhoto(projectId: string, pkgId: string, photoId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_photo_drop", { p_photo: photoId });
  // Taken off the room, so the public copy goes too - it only existed to be
  // shown to bidders.
  if (!error && data?.ok && data?.path) {
    await supabase.storage.from("public-media").remove([data.path as string]);
  }
  revalidatePath(here(projectId, pkgId));
  if (error || !data?.ok) {
    redirect(here(projectId, pkgId, { error: data?.reason ?? "Could not take that one down." }));
  }
  redirect(here(projectId, pkgId, { ok: "photo-off" }));
}
