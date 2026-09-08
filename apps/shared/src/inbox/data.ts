import { createClient } from "../supabase/server";
import { rpc } from "../rpc";
import { timed } from "../perf";

// The inbox, as the portal has always modelled it: one thread of time
// carrying what came to you and what you sent, plus the invitations waiting
// on an answer. Four apps, one model - the functions below are the same ones
// the portal calls, so a message read in the builder app is read everywhere.
export type Msg = {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  channel: string | null;
  body: string;
  sent_at: string;
  status: string;
  read_at: string | null;
  handled_at: string | null;
  project_id: string | null;
  project_name: string | null;
  action_id: string | null;
  action: string | null;
  who: string;
  mine: boolean;
  pending: boolean;
};

export type Invites = {
  incoming: { id: string; project_id: string; project_name: string; by: string | null; seat: string | null; message: string | null }[];
  outcomes: { id: string; project_id: string; project_name: string; who: string | null; status: string; at: string | null }[];
};

export type Target = {
  project_id: string;
  project_name: string;
  people: { contact_id: string; name: string; seat: string | null }[];
};

export type InboxData = { messages: Msg[]; invites: Invites; targets: Target[]; failed: boolean };

export const EMPTY: InboxData = {
  messages: [], invites: { incoming: [], outcomes: [] }, targets: [], failed: false,
};

// Three reads, none depending on another, so they leave together - one
// round trip's worth of wall clock instead of three.
export async function loadInbox(limit = 100): Promise<InboxData> {
  const supabase = await createClient();
  const [msgs, invs, tgts] = await Promise.all([
    timed("inbox.messages", () => rpc<Msg[]>(supabase, "portal_my_messages", { p_limit: limit })),
    timed("inbox.invites", () => rpc<Invites>(supabase, "portal_my_invites")),
    timed("inbox.targets", () => rpc<Target[]>(supabase, "portal_compose_targets")),
  ]);
  return {
    messages: Array.isArray(msgs.data) ? msgs.data : [],
    invites: {
      incoming: invs.data?.incoming ?? [],
      outcomes: invs.data?.outcomes ?? [],
    },
    targets: Array.isArray(tgts.data) ? tgts.data : [],
    failed: !!msgs.error,
  };
}

export const unreadCount = (m: Msg[]) => m.filter((x) => x.pending).length;
