"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// AWARDING WORK. Two ways in, one rule underneath: portal_award_trade seats
// them and hands back the contract (migration 106); portal_award_add_trade
// makes the contact first when the person is not on file yet (107). Since
// 154 the award can name a contract that already exists - the seat is bound
// to it and no placeholder opens - and the person may be left out and read
// off the contract. Who may do it is can_edit_project's business, asked in
// the database, not here.

const txt = (v: FormDataEntryValue | null) => { const s = String(v ?? "").trim(); return s || null; };

export async function awardTrade(projectId: string, formData: FormData) {
  const here = (params: Record<string, string>) =>
    `/project/${projectId}/award?${new URLSearchParams(params).toString()}`;

  const trade = txt(formData.get("trade"));
  const contact = txt(formData.get("contact"));
  const contract = txt(formData.get("contract"));
  const name = txt(formData.get("name"));
  const note = txt(formData.get("note"));

  // A name typed into "someone new" wins over a leftover selection, because
  // typing is the more deliberate of the two - unless a contract was picked
  // as well, and then the two are contradicting each other: a contract that
  // exists already names its party, and somebody not on file is not them.
  if (name && contract) {
    redirect(here({ error: "A contract that exists already names its party. Pick them from the list, or leave the contract on “new” to add somebody.", trade: trade ?? "" }));
  }
  if (!contact && !name && !contract) {
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
        p_contract: contract,
      });

  if (error) redirect(here({ error: friendly(error.message, "That award did not go through."), trade: trade ?? "" }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That award did not go through.", trade: trade ?? "" }));

  revalidatePath(`/project/${projectId}/award`);
  revalidatePath(`/project/${projectId}`);
  revalidatePath(`/project/${projectId}/money`);

  const who = data?.who ?? "They";
  const what = data?.trade ? ` the ${String(data.trade).toLowerCase()}` : "";
  // When the identifier typed in already belonged to somebody, the award went
  // to THEM, and saying so is the difference between a helpful match and a
  // silent one (migration 111: it now refuses outright when an email and a
  // phone name two different people).
  const matched = data?.matched_note ? `${data.matched_note} ` : "";
  // Only claim a contract when one exists. It did not always, and the screen
  // said it did — migration 111. When the award landed on a contract that
  // was already there, say which, and say what became of the placeholder the
  // seat used to sit on.
  const landed = data?.existing
    ? ` On “${data.contract_title}”${data.contract_status === "Complete" ? " — complete, so this is the record of past work" : ""}.`
    : "";
  const moved = data?.rebound_from_title
    ? ` Their seat moved off “${data.rebound_from_title}”, which is still on the job with nobody on it.`
    : "";
  const terms = data?.bounded && !data?.existing
    ? " The contract is awarded; the terms are still to be agreed on the money screen."
    : "";
  redirect(here({
    ok: matched + (data?.seated === false
      ? `${who} already held a seat here —${what || " the work"} is theirs.${landed}${moved}${terms}`
      : `${who} has${what || " the work"}.${landed}${terms}`),
  }));
}

// TAKING SOMEBODY OFF. Shahar: "we need a way to modify the list of people on
// the project - remove for example." Nothing is deleted - the seat is marked
// removed with the date, because who held what and when is worth keeping.
export async function removeSeat(projectId: string, memberId: string) {
  const supabase = await createClient();
  const here = (params: Record<string, string>) =>
    `/project/${projectId}/award?${new URLSearchParams(params).toString()}`;

  const { data, error } = await supabase.rpc("portal_seat_remove", { p_member: memberId, p_why: null });
  if (error) redirect(here({ error: friendly(error.message, "That seat could not be taken off.") }));
  if (data?.ok === false) redirect(here({ error: data.reason ?? "That seat could not be taken off." }));

  revalidatePath(`/project/${projectId}/award`);
  revalidatePath(`/project/${projectId}`);
  revalidatePath(`/project/${projectId}/money`);
  redirect(here({ ok: data?.note ?? "They are off this job." }));
}
