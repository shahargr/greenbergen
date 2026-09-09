import { createClient } from "../supabase/server";
import { rpc } from "../rpc";
import { timed } from "../perf";

// The inbox, as the portal has always modelled it: one thread of time
// carrying what came to you and what you sent, plus the invitations waiting
// on an answer. Four apps, one model - the functions below are the same ones
// the portal calls, so a message read in the builder app is read everywhere.
export type MsgKind = "bid" | "question" | "task" | "system" | "note";

export type Msg = {
  id: string;
  direction: "inbound" | "outbound" | "internal";
  channel: string | null;
  body: string;
  // The body's first line, which is what these bodies are written to be.
  subject: string;
  // What it IS, so the row can offer the right verbs (migration 035).
  kind: MsgKind;
  // Who it is with, for a reply. Null on a system message.
  with_contact_id: string | null;
  file: { id: string; path: string; kind: string | null; mime: string | null; name: string | null } | null;
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

export type InboxData = {
  messages: Msg[]; invites: Invites; targets: Target[]; failed: boolean;
  // Jobs this person has a LIVE offer on. A bid invitation and a note from a
  // neighbour are not the same message and must not carry the same verbs -
  // and the honest way to tell them apart is to ask which offers are open,
  // not to read the body text and hope.
  offers: string[];
  // Signed URLs for any image attached to a message, keyed by storage path.
  // One round trip for the page, taken after the messages land because it
  // needs their paths - the only read here that depends on another.
  fileUrls: Record<string, string>;
};

export const EMPTY: InboxData = {
  messages: [], invites: { incoming: [], outcomes: [] }, targets: [], failed: false, offers: [], fileUrls: {},
};

// Four reads, none depending on another, so they leave together - one round
// trip's worth of wall clock instead of four. homeowner_offers() is
// bidder-scoped, so in the homeowner app it simply comes back empty and
// costs nothing but the round trip it shares.
export async function loadInbox(limit = 100): Promise<InboxData> {
  const supabase = await createClient();
  const [msgs, invs, tgts, offs] = await Promise.all([
    timed("inbox.messages", () => rpc<Msg[]>(supabase, "portal_my_messages", { p_limit: limit })),
    timed("inbox.invites", () => rpc<Invites>(supabase, "portal_my_invites")),
    timed("inbox.targets", () => rpc<Target[]>(supabase, "portal_compose_targets")),
    timed("inbox.offers", () => rpc<{ project_id: string }[]>(supabase, "homeowner_offers")),
  ]);
  // Attachments, signed in one call. Only images are worth a URL here: a
  // document in an inbox row is a filename, not a preview.
  const shots = (Array.isArray(msgs.data) ? msgs.data : [])
    .map((m) => (m.file?.kind === "photo" ? m.file.path : null))
    .filter((p): p is string => !!p);
  const urls: Record<string, string> = {};
  if (shots.length > 0) {
    const { data: signed } = await timed("inbox.files", () =>
      supabase.storage.from("project-media").createSignedUrls([...new Set(shots)], 3600));
    for (const row of signed ?? []) if (row.path && row.signedUrl) urls[row.path] = row.signedUrl;
  }

  return {
    messages: Array.isArray(msgs.data) ? msgs.data : [],
    invites: {
      incoming: invs.data?.incoming ?? [],
      outcomes: invs.data?.outcomes ?? [],
    },
    targets: Array.isArray(tgts.data) ? tgts.data : [],
    failed: !!msgs.error,
    offers: Array.isArray(offs.data) ? offs.data.map((o) => o.project_id) : [],
    fileUrls: urls,
  };
}

export const unreadCount = (m: Msg[]) => m.filter((x) => x.pending).length;
