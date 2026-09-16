"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";

// Scope, relayed. Every rule lives in the database and this file holds none
// of it: portal_scope_trades_set, portal_scope_copy, portal_scope_packages
// and portal_scope_item_save each check can_edit_project themselves and
// raise when the answer is no. So the app never decides who may write - it
// carries the database's answer back to the person who tried.

const to = (projectId: string, params: Record<string, string>) => {
  const q = new URLSearchParams(params).toString();
  return `/project/${projectId}/scope${q ? `?${q}` : ""}`;
};

// The trade in focus and the way back, when the screen was opened from a
// trade: they came in on the URL and go out on it, so a save does not drop
// you into the whole-job view you did not ask for.
const keep = (formData: FormData) => {
  const focus = String(formData.get("focus") ?? "").trim();
  const back = String(formData.get("back") ?? "").trim();
  return { ...(focus ? { trade: focus } : {}), ...(back ? { back } : {}) };
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Step 1 - which trades this job needs. The chosen list becomes the
// project's bid needs; a trade dropped here is removed unless a bid package
// already hangs off it, which the database decides, not this.
export async function setTrades(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const trades = formData.getAll("trade").map((v) => String(v));
  const k = keep(formData);

  const { error } = await supabase.rpc("portal_scope_trades_set", {
    p_project: projectId,
    p_trades: trades,
  });
  revalidatePath(`/project/${projectId}/scope`);
  redirect(error
    ? to(projectId, { step: "1", error: error.message, ...k })
    : to(projectId, { step: "2", ok: k.trade ? `${k.trade} is on this job.` : `${plural(trades.length, "trade")} on this job.`, ...k }));
}

// Step 2 - the blueprint's lines for those trades, copied down into this
// project's own scope. Copy down, do not link (rulebook 41): from here the
// project owns the text.
//
// Unticking is destructive by design - portal_scope_copy removes a copied
// line that nobody has committed to yet. It will not touch a line that
// carries a contract or already sits in a bid package, so a signed scope
// cannot be edited out from under a contractor.
export async function copyLines(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const lines = formData.getAll("line").map((v) => String(v));
  const k = keep(formData);

  const { error } = await supabase.rpc("portal_scope_copy", {
    p_project: projectId,
    p_blueprint_ids: lines,
  });
  revalidatePath(`/project/${projectId}/scope`);
  // In focus the count sent includes the other trades' lines, carried
  // hidden, so the line total is not the trade's - say what was saved, not
  // a number that would mislead.
  redirect(error
    ? to(projectId, { step: "2", error: error.message, ...k })
    : to(projectId, { step: k.trade ? "2" : "3", ok: k.trade ? `${k.trade}'s scope saved.` : `${plural(lines.length, "line")} in scope.`, ...k }));
}

// Step 3 - scope becomes draft bid packages, one per trade, carrying that
// trade's scope lines as the items every bidder prices. This is the seam
// where the builder's scope reaches apps/contractor.
export async function makePackages(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_scope_packages", { p_project: projectId });
  const made = (data as { created?: number } | null)?.created ?? 0;

  revalidatePath(`/project/${projectId}/scope`);
  revalidatePath(`/project/${projectId}`);
  redirect(error
    ? to(projectId, { step: "3", error: error.message })
    : to(projectId, {
        step: "3",
        ok: made === 0
          ? "Every trade already has a package."
          : `${plural(made, "bid package")} drafted from the scope.`,
      }));
}

// A line in the owner's own words. Fill the trade wording too and the same
// line goes to both sides: your sentence on this screen, the trade's
// sentence in the proposal.
export async function addOwnerLine(projectId: string, formData: FormData) {
  const supabase = await createClient();
  const summary = String(formData.get("owner_summary") ?? "").trim();
  if (!summary) redirect(to(projectId, { error: "Say what you want first." }));

  const { error } = await supabase.rpc("portal_scope_item_save", {
    p: {
      project_id: projectId,
      owner_summary: summary,
      item: String(formData.get("item") ?? "").trim() || null,
      trade: String(formData.get("trade") ?? "").trim() || null,
    },
  });
  revalidatePath(`/project/${projectId}/scope`);
  redirect(error
    ? to(projectId, { error: error.message })
    : to(projectId, { ok: "Added to the scope." }));
}
