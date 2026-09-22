"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { friendly } from "@shared/rpc";

// ANSWERING ONE STEP.
//
// portal_step_answer does all of it and has since long before this screen:
// it records the answer, CANCELS whatever that answer rules out (step 30,
// the meter upsize, disappears the moment step 20 comes back "yes"), and
// closes the step. Nothing here decides anything - it relays and reports.
export async function answerStep(projectId: string, formData: FormData) {
  const here = `/project/${projectId}/steps`;
  const action = String(formData.get("action_id") ?? "");
  const answer = String(formData.get("answer") ?? "").trim();
  if (!action) redirect(`${here}?error=${encodeURIComponent("Which step?")}`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("portal_step_answer", {
    p_action: action,
    p_answer: answer,
    p_note: String(formData.get("note") ?? "").trim() || null,
  });
  if (error) redirect(`${here}?error=${encodeURIComponent(friendly(error.message))}`);
  if (data?.ok === false) redirect(`${here}?error=${encodeURIComponent(data.reason ?? "That did not save.")}`);

  revalidatePath(here);
  revalidatePath(`/project/${projectId}`);

  // SAY WHAT THE ANSWER DID. An answer that quietly deletes three steps is
  // alarming; one that says it ruled them out is the process working.
  const ruled = Array.isArray(data?.ruled_out) ? data.ruled_out.length : 0;
  const said = data?.closed === false
    ? "Answer recorded — the step itself is still open."
    : ruled > 0
      ? `Answered. ${ruled} step${ruled === 1 ? "" : "s"} ruled out by it.`
      : "Answered, and the step is done.";
  redirect(`${here}?ok=${encodeURIComponent(said)}`);
}
