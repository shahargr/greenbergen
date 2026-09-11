"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// The bid package, from the site. Four writes, every rule in the database:
// record what a bidder said, run a negotiation round, award the package, and
// invite one more person. Nothing here decides anything - portal_bid_reply,
// portal_bid_negotiate, portal_bid_award and portal_bid_invite do.

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
