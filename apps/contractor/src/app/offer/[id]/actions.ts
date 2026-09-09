"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// The three ways an offer ends. All three are database functions that
// already decide what is allowed; this file relays their answer and never
// second-guesses it.
//
// The order matters and is Shahar's: accept as is · ask for details (the
// price is NOT approved) · not interested.

// ACCEPT. First accept wins - homeowner_offer_accept locks the row, writes
// the contract, binds the payment stages, seats the contractor and settles
// the other bids. This is the moment the address is released, so the screen
// after it is the address.
export async function acceptOffer(projectId: string, contactId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_offer_accept", {
    p_project: projectId, p_contact: contactId,
  });
  revalidatePath("/work"); revalidatePath("/jobs"); revalidatePath(`/offer/${projectId}`);
  if (error || !data?.ok) {
    redirect(`/offer/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not accept that offer."))}`);
  }
  // Straight to the job: they have the address now, and that is the thing
  // they wanted. Nobody wants to read a confirmation screen first.
  redirect(`/project/${projectId}?ok=accepted`);
}

// ASK. Not an acceptance and not a bid - see migration 033. The offer stays
// open to everyone it went to, the price is not agreed and the address stays
// withheld, all of which the screen says out loud.
export async function askAboutOffer(projectId: string, formData: FormData) {
  const note = String(formData.get("note") ?? "").trim();
  if (!note) redirect(`/offer/${projectId}?error=${encodeURIComponent("Write what you need to know.")}`);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_offer_ask", { p_project: projectId, p_note: note });
  revalidatePath(`/offer/${projectId}`);
  if (error || !data?.ok) {
    redirect(`/offer/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not send that question."))}`);
  }
  redirect(`/offer/${projectId}?ok=asked`);
}

// PASS. homeowner_offer_decline marks your bid declined; the job stays
// posted for everyone else. Reversible only by us, so the screen asks
// plainly rather than putting it beside the accept button.
export async function passOffer(projectId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_offer_decline", { p_project: projectId });
  revalidatePath("/work"); revalidatePath("/inbox");
  if (error || !data?.ok) {
    redirect(`/offer/${projectId}?error=${encodeURIComponent(friendly(data?.reason ?? error?.message ?? "Could not pass on that."))}`);
  }
  redirect("/work?ok=passed");
}
