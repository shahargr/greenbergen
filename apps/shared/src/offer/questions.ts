import { createClient } from "../supabase/server";
import { rpc } from "../rpc";
import { timed } from "../perf";

// Pre-acceptance questions (BUILD.md C9, migrations 033-034), from whichever
// side you are on. `mine` true means you asked it; false means it is yours to
// answer.
//
// THE THREAD IS NOT LOADED HERE, deliberately. Once a question is approved
// the conversation is ordinary directed messages carrying the question's
// action_id, and portal_my_messages already returns a message to whoever it
// is addressed to - without asking about project membership, which is the
// whole point, since the contractor is not on the project. So the back and
// forth appears in both inboxes on its own and this read stays one call.
export type OfferQuestion = {
  action_id: string;
  project_id: string;
  package: string | null;
  status: string;
  state: "asked" | "open" | "declined" | "closed";
  mine: boolean;
  asked_by: string | null;
  asked_at: string;
  question: string | null;
  town: string | null;
  replies: number;
  unread: number;
};

export async function loadQuestions(): Promise<OfferQuestion[]> {
  const supabase = await createClient();
  const { data } = await timed("offer.questions", () => rpc<OfferQuestion[]>(supabase, "homeowner_offer_questions"));
  return Array.isArray(data) ? data : [];
}

// What the contractor actually wrote. The notes field carries our framing
// first and the question after a marker; the framing is for whoever picks
// the task up, not for the person reading it in their inbox.
export function askedText(q: OfferQuestion): string {
  const n = q.question ?? "";
  const i = n.indexOf("What they asked:");
  return (i >= 0 ? n.slice(i + "What they asked:".length) : n).trim();
}
