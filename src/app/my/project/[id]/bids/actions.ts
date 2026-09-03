"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { reviewBids } from "@/lib/einstein";

// Bid Planner, Phase 1. Every write goes through the gated RPCs
// (portal_bid_*); these actions only shape form data and route back.

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };
// Tri-state checkbox: a hidden "0" precedes the checkbox "1"; last value wins.
// Nothing sent -> null (keep the stored value).
const flag = (fd: FormData, name: string) => {
  const all = fd.getAll(name).map(String);
  if (all.length === 0) return null;
  return all[all.length - 1] === "1";
};
const pkgUrl = (projectId: string, pkgId: string) => `/my/project/${projectId}/bids/${pkgId}`;

export async function createPackage(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const budgetCategoryId = txt(formData.get("budget_category"));
  if (!budgetCategoryId) redirect(`/my/project/${projectId}/bids?error=${encodeURIComponent("Pick a budget line.")}`);
  const { data, error } = await supabase.rpc("portal_bid_package_save", {
    p_project: projectId, p_budget_category_id: budgetCategoryId, p_trade: txt(formData.get("trade")),
  });
  if (error || !data?.ok) redirect(`/my/project/${projectId}/bids?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not create the package.")}`);
  revalidatePath(`/my/project/${projectId}`);
  redirect(`${pkgUrl(projectId, data.id)}?saved=1`);
}

export async function savePackage(projectId: string, pkgId: string, formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_bid_package_save", {
    p_project: projectId, p_pkg: pkgId,
    p_trade: txt(formData.get("trade")),
    p_scope_summary: txt(formData.get("scope_summary")),
    p_budget_visible: flag(formData, "budget_visible"),
    p_deposit_pct: num(formData.get("deposit_pct")),
    p_retainage_pct: num(formData.get("retainage_pct")),
    p_retainage_release_trigger: txt(formData.get("retainage_release_trigger")),
    p_net_days: num(formData.get("net_days")),
    p_consumables_by: txt(formData.get("consumables_by")),
    p_finish_material_by: txt(formData.get("finish_material_by")),
    p_gl_occ: num(formData.get("gl_occ")),
    p_gl_agg: num(formData.get("gl_agg")),
    p_wc: flag(formData, "wc"),
    p_coi: flag(formData, "coi"),
    p_reply_by: txt(formData.get("reply_by")),
    p_status: txt(formData.get("status")),
  });
  revalidatePath(pkgUrl(projectId, pkgId));
  revalidatePath(`/my/project/${projectId}`);
  redirect(error || !data?.ok
    ? `${pkgUrl(projectId, pkgId)}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not save.")}`
    : `${pkgUrl(projectId, pkgId)}?saved=1`);
}

export async function setPackageItems(projectId: string, pkgId: string, formData: FormData) {
  const supabase = await createClient();
  const items = formData.getAll("item").map(String);
  const required = formData.getAll("req").map(String);
  const { data, error } = await supabase.rpc("portal_bid_package_items_set", { p_pkg: pkgId, p_items: items, p_required: required });
  revalidatePath(pkgUrl(projectId, pkgId));
  redirect(error || !data?.ok
    ? `${pkgUrl(projectId, pkgId)}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not save the scope.")}`
    : `${pkgUrl(projectId, pkgId)}?saved=1`);
}

export async function inviteBidders(projectId: string, pkgId: string, formData: FormData) {
  const supabase = await createClient();
  const contacts = formData.getAll("contact").map(String);
  if (contacts.length === 0) redirect(`${pkgUrl(projectId, pkgId)}?error=${encodeURIComponent("Pick at least one person to invite.")}`);
  const { data, error } = await supabase.rpc("portal_bid_invite", { p_pkg: pkgId, p_contacts: contacts });
  revalidatePath(pkgUrl(projectId, pkgId));
  redirect(error || !data?.ok
    ? `${pkgUrl(projectId, pkgId)}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not invite.")}`
    : `${pkgUrl(projectId, pkgId)}?saved=1`);
}

// Documents for a package (pkgId) or a reply (bidId): metadata + link now,
// bytes after the response (same pattern as task evidence).
export async function attachBidDocs(projectId: string, pkgId: string | null, bidId: string | null, back: string, formData: FormData) {
  const supabase = await createClient();
  const files = formData.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) redirect(`${back}?error=${encodeURIComponent("Add at least one file first.")}`);
  const pending: { path: string; bytes: ArrayBuffer; mime: string | null }[] = [];
  let i = 0;
  for (const file of files) {
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? "").toLowerCase();
    const path = bidId
      ? `${projectId}/bids/${pkgId ?? "pkg"}/replies/${bidId}/${Date.now()}-${i}${ext}`
      : `${projectId}/bids/${pkgId}/${Date.now()}-${i}${ext}`;
    const bytes = await file.arrayBuffer();
    const { data: fileId, error } = await supabase.rpc("record_project_file", {
      p_project_id: projectId, p_path: path, p_file_name: file.name || `document${ext}`,
      p_mime: file.type || null, p_size: file.size,
      p_caption: bidId ? "Bid reply document" : "Bid package document", p_kind: null,
    });
    if (error || !fileId) redirect(`${back}?error=${encodeURIComponent(error?.message ?? "Could not record the file.")}`);
    const { data: att } = await supabase.rpc("portal_bid_doc_attach", { p_file_id: fileId, p_pkg: bidId ? null : pkgId, p_bid: bidId });
    if (!att?.ok) redirect(`${back}?error=${encodeURIComponent(att?.reason ?? "Could not attach the file.")}`);
    pending.push({ path, bytes, mime: file.type || null });
    i += 1;
  }
  after(async () => {
    for (const f of pending) {
      await supabase.storage.from("project-media").upload(f.path, f.bytes, { contentType: f.mime || undefined, upsert: true });
    }
  });
  revalidatePath(back);
  redirect(`${back}?saved=1`);
}

// A bidder's reply, line by line against the package.
export async function submitReply(bidId: string, formData: FormData) {
  const supabase = await createClient();
  const back = `/my/bid/${bidId}`;
  const itemIds = String(formData.get("items") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const lineItems = itemIds.map((id) => ({
    scope_item_id: id,
    included: formData.get(`inc_${id}`) === "on",
    price: num(formData.get(`price_${id}`)),
  }));
  const termsReply = {
    deposit_pct: num(formData.get("r_deposit")),
    retainage_pct: num(formData.get("r_retainage")),
    net_days: num(formData.get("r_net")),
    note: txt(formData.get("r_terms_note")),
  };
  const insuranceReply = {
    gl_held: formData.get("ins_gl") === "on",
    wc_held: formData.get("ins_wc") === "on",
    coi: formData.get("ins_coi") === "on",
    carrier: txt(formData.get("ins_carrier")),
  };
  const { data, error } = await supabase.rpc("portal_bid_reply", {
    p_bid: bidId, p_line_items: lineItems, p_terms_reply: termsReply, p_insurance_reply: insuranceReply,
    p_amount: num(formData.get("amount")), p_valid_until: txt(formData.get("valid_until")), p_notes: txt(formData.get("notes")),
  });
  revalidatePath(back);
  redirect(error || !data?.ok
    ? `${back}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not submit the reply.")}`
    : `${back}?saved=1`);
}

// Einstein review of a package's replies. Phase 1 (internal-first) is
// gathered here from the platform — the comparison grid and each bidder's
// history; Phase 2 is one model call. The result is a structured brief saved
// to bid_reviews; it recommends, it never awards.
export async function runAiReview(projectId: string, pkgId: string) {
  const supabase = await createClient();
  const back = pkgUrl(projectId, pkgId);
  const [{ data: cmp }, { data: brief }] = await Promise.all([
    supabase.rpc("portal_bid_compare", { p_pkg: pkgId }),
    supabase.rpc("portal_project_brief", { p_project: projectId }),
  ]);
  if (!cmp) redirect(`${back}?error=${encodeURIComponent("Reviewing this package is not yours to do.")}`);
  type CmpBid = { id: string; bidder: string | null; bidder_contact_id: string | null } & Record<string, unknown>;
  const bids = ((cmp.bids ?? []) as CmpBid[]);
  if (bids.length === 0) redirect(`${back}?error=${encodeURIComponent("No replies to review yet.")}`);

  const histories = await Promise.all(bids.map(async (b) =>
    b.bidder_contact_id ? (await supabase.rpc("portal_bidder_history", { p_contact: b.bidder_contact_id })).data : null));
  const out = await reviewBids({
    // The owner's brief (description, specs, attached files by name) rides
    // along so the review judges replies against what was actually asked.
    package: { ...(cmp.package ?? {}), owner_brief: brief ? { description: brief.description, specs: brief.specs, files: (brief.files as { file_name: string }[]).map((f) => f.file_name) } : null },
    items: ((cmp.items ?? []) as { scope_item_id: string; item: string; is_required: boolean }[])
      .map((i) => ({ scope_item_id: i.scope_item_id, item: i.item, is_required: i.is_required })),
    bids: bids.map((b, i) => ({ ...b, history: histories[i] })),
  });
  if (!out.ok) redirect(`${back}?error=${encodeURIComponent(out.reason)}`);

  const ids = new Set(bids.map((b) => b.id));
  const rec = out.review.recommended_bid_id && ids.has(out.review.recommended_bid_id) ? out.review.recommended_bid_id : null;
  const { data: saved, error } = await supabase.rpc("portal_bid_review_save", {
    p_pkg: pkgId, p_reviewer: "ai", p_model: out.model,
    p_ranking: out.review.ranking ?? [], p_risks: out.review.risks ?? [], p_questions: out.review.questions ?? [],
    p_recommended_bid_id: rec, p_confidence: out.review.confidence ?? null, p_unverified: out.review.unverified ?? null,
  });
  revalidatePath(back);
  redirect(error || !saved?.ok
    ? `${back}?error=${encodeURIComponent(saved?.reason ?? error?.message ?? "Could not save the review.")}`
    : `${back}?saved=1`);
}

// Award a package to one received reply. The RPC marks the winner and the
// rest, and closes the package; contract + signature are a later step.
export async function awardBid(projectId: string, pkgId: string, bidId: string, formData: FormData) {
  const supabase = await createClient();
  const back = pkgUrl(projectId, pkgId);
  const { data, error } = await supabase.rpc("portal_bid_award", { p_pkg: pkgId, p_bid: bidId, p_reason: txt(formData.get("reason")) });
  revalidatePath(back);
  revalidatePath(`/my/project/${projectId}`);
  redirect(error || !data?.ok
    ? `${back}?error=${encodeURIComponent(data?.reason ?? error?.message ?? "Could not award.")}`
    : `${back}?saved=1`);
}
