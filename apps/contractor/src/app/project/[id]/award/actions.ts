"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// AWARDING WORK. Two ways in, one rule underneath: portal_award_trade seats
// them and hands back the contract (migration 106); portal_award_add_trade
// makes the contact first when the person is not on file yet (107). Who may
// do it is can_edit_project's business, asked in the database, not here.

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function awardTrade(projectId: string, formData: FormData) {
  const here = (params: Record<string, string>) =>
    `/project/${projectId}/award?${new URLSearchParams(params).toString()}`;

  const trade = txt(formData.get("trade"));
  const contact = txt(formData.get("contact"));
  const name = txt(formData.get("name"));
  const note = txt(formData.get("note"));

  // A name typed into "someone new" wins over a leftover selection, because
  // typing is the more deliberate of the two.
  if (!contact && !name) {
    redirect(here({ error: "Pick who is taking it, or type their name in below.", trade: trade ?? "" }));
  }

  const supabase = await createClient();
  const { data, error } = name
    ? await supabase.rpc("portal_award_add_trade", {
        p_project: projectId, p_name: name, p_trade: trade,
        p_company: txt(formData.get("company")), p_phone: txt(formData.get("phone")),
        p_email: txt(formData.get("email")), p_note: note,
      })
    : await supabase.rpc("portal_award_trade", {
        p_project: projectId, p_contact: contact, p_trade: trade, p_note: note,
      });

  if (error) redirect(here({ error: friendly(error.message, "That award did not go through."), trade: trade ?? "" }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That award did not go through.", trade: trade ?? "" }));

  revalidatePath(`/project/${projectId}/award`);
  revalidatePath(`/project/${projectId}`);
  revalidatePath(`/project/${projectId}/money`);

  const who = data?.who ?? "They";
  const what = data?.trade ? ` the ${String(data.trade).toLowerCase()}` : "";
  // A phone number is a person (migration 108): when the number typed in
  // already belonged to somebody, the award went to THEM, and saying so is
  // the difference between a helpful match and a silent one.
  const matched = data?.matched_note ? `${data.matched_note} ` : "";
  redirect(here({
    ok: matched + (data?.seated === false
      ? `${who} already held a seat here — the${what || " work"} is theirs.`
      : `${who} has${what || " the work"}. The contract is a placeholder until you agree the terms.`),
  }));
}
