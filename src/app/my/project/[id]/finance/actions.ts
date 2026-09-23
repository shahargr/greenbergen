"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Budget wizard. Every write goes through the gated RPCs (portal_budget_*,
// portal_bid_package_save); these actions only shape form data and route back.

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/[$,%\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

const back = (projectId: string, q: string | null, extra: string) => {
  const qq = q ? `&q=${encodeURIComponent(q)}` : "";
  return `/my/project/${projectId}/finance?${extra}${qq}`;
};

function bounce(projectId: string, q: string | null, reason: string): never {
  redirect(back(projectId, q, `error=${encodeURIComponent(reason)}`));
}

// Create a line, or (with an id) edit one. Only the keys the form posts
// reach the RPC, so a partial form never blanks the rest of the row.
export async function saveBudgetLine(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const q = txt(formData.get("q"));
  const id = txt(formData.get("id"));
  const p: Record<string, unknown> = id ? { id } : { project_id: projectId };
  for (const key of ["category", "phase", "trade", "cost_type", "notes"]) {
    if (formData.has(key)) p[key] = txt(formData.get(key));
  }
  if (formData.has("target_amount")) p.target_amount = num(formData.get("target_amount"));
  const { data, error } = await supabase.rpc("portal_budget_line_save", { p });
  if (error || !data?.ok) bounce(projectId, q, data?.reason ?? error?.message ?? "Could not save the line.");
  revalidatePath(`/my/project/${projectId}/finance`);
  redirect(back(projectId, q, "ok=1"));
}

export async function deleteBudgetLine(projectId: string, lineId: string, formData: FormData) {
  const supabase = await createClient();
  const q = txt(formData.get("q"));
  const { data, error } = await supabase.rpc("portal_budget_line_delete", { p_id: lineId });
  if (error || !data?.ok) bounce(projectId, q, data?.reason ?? error?.message ?? "Could not delete the line.");
  revalidatePath(`/my/project/${projectId}/finance`);
  redirect(back(projectId, q, "ok=1"));
}

// Copy another project's line LIST (never its amounts) into this budget.
export async function seedBudget(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const from = txt(formData.get("from"));
  if (!from) bounce(projectId, null, "Pick a project to copy the line list from.");
  const { data, error } = await supabase.rpc("portal_budget_seed", { p_project: projectId, p_from: from });
  if (error || !data?.ok) bounce(projectId, null, data?.reason ?? error?.message ?? "Could not seed the budget.");
  revalidatePath(`/my/project/${projectId}/finance`);
  redirect(back(projectId, null, `ok=${encodeURIComponent(`${data.copied} lines copied`)}`));
}

// Open a bid package from a line - the existing bid room takes it from there.
export async function startBid(projectId: string, lineId: string, trade: string | null, formData: FormData) {
  const supabase = await createClient();
  const q = txt(formData.get("q"));
  const { data, error } = await supabase.rpc("portal_bid_package_save", {
    p_project: projectId, p_budget_category_id: lineId, p_trade: trade,
  });
  if (error || !data?.ok) bounce(projectId, q, data?.reason ?? error?.message ?? "Could not start the bid.");
  revalidatePath(`/my/project/${projectId}`);
  redirect(`/my/project/${projectId}/bids/${data.id}?saved=1`);
}

export async function linkContract(projectId: string, lineId: string, formData: FormData) {
  const supabase = await createClient();
  const q = txt(formData.get("q"));
  const contract = txt(formData.get("contract"));
  if (!contract) bounce(projectId, q, "Pick the contract to file against this line.");
  const { data, error } = await supabase.rpc("portal_budget_link_contract", { p_line: lineId, p_contract: contract });
  if (error || !data?.ok) bounce(projectId, q, data?.reason ?? error?.message ?? "Could not link the contract.");
  revalidatePath(`/my/project/${projectId}/finance`);
  redirect(back(projectId, q, "ok=1"));
}

export async function unlinkContract(projectId: string, lineId: string, contractId: string, formData: FormData) {
  const supabase = await createClient();
  const q = txt(formData.get("q"));
  const { data, error } = await supabase.rpc("portal_budget_link_contract", {
    p_line: lineId, p_contract: contractId, p_unlink: true,
  });
  if (error || !data?.ok) bounce(projectId, q, data?.reason ?? error?.message ?? "Could not unlink the contract.");
  revalidatePath(`/my/project/${projectId}/finance`);
  redirect(back(projectId, q, "ok=1"));
}
