"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "../supabase/server";
import { friendly } from "../rpc";

// The homeowner's half of C9, and the thread that follows. Shared because
// both apps touch it from different sides and neither should own it.
//
// Every one of these carries the calling app's own path in a hidden `base`,
// the same way the inbox actions do - the homeowner answers from /inbox, the
// contractor writes from /offer/<id>, and the function is the same.
function base(formData: FormData): string {
  const s = String(formData.get("base") ?? "");
  return s.startsWith("/") && !s.startsWith("//") ? s : "/inbox";
}
const back = (b: string, msg: string, isError = false) =>
  `${b}${b.includes("?") ? "&" : "?"}${isError ? "error" : "ok"}=${encodeURIComponent(msg)}`;

// APPROVE: the answer is the thread opener. Nothing else moves - not the
// bid, not the booking, not the address.
export async function answerQuestion(formData: FormData) {
  const b = base(formData);
  const reply = String(formData.get("reply") ?? "").trim();
  if (!reply) redirect(back(b, "Write your answer first.", true));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_offer_question_respond", {
    p_action: String(formData.get("action") ?? ""), p_approve: true, p_reply: reply,
  });
  revalidatePath(b);
  redirect(error || !data?.ok
    ? back(b, friendly(data?.reason ?? error?.message ?? "Could not send that."), true)
    : back(b, "Answered. They can reply to you about this job, and only this job."));
}

// DECLINE: still an answer. The contractor gets one message saying so, and
// the question closes - no thread, nothing further.
export async function declineQuestion(formData: FormData) {
  const b = base(formData);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_offer_question_respond", {
    p_action: String(formData.get("action") ?? ""), p_approve: false,
    p_reply: String(formData.get("reply") ?? "").trim() || null,
  });
  revalidatePath(b);
  redirect(error || !data?.ok
    ? back(b, friendly(data?.reason ?? error?.message ?? "Could not send that."), true)
    : back(b, "Declined. They were told, and the offer is still theirs to take."));
}

// Either party writes into an open thread. Closed or declined, the database
// refuses - which is what stops this becoming general messaging between two
// people who share no project.
export async function replyInThread(formData: FormData) {
  const b = base(formData);
  const body = String(formData.get("body") ?? "").trim();
  if (!body) redirect(back(b, "Write something first.", true));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("homeowner_offer_thread_send", {
    p_action: String(formData.get("action") ?? ""), p_body: body,
  });
  revalidatePath(b);
  redirect(error || !data?.ok
    ? back(b, friendly(data?.reason ?? error?.message ?? "Could not send that."), true)
    : back(b, "Sent."));
}
