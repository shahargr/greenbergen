import { createClient } from "./supabase/server";
import { rpc } from "./rpc";
import { timed } from "./perf";

// The number on the inbox icon, on every screen.
//
// my_unread_count() (migration 035) is one integer over the same predicate
// portal_my_messages calls `pending`, so the badge and the list can never
// disagree about what is waiting - and a shell does not have to load an
// inbox to draw a dot.
//
// It never throws: a badge is not worth failing a page for. No count reads
// as no badge, which is also what zero looks like.
export async function unreadForShell(): Promise<number> {
  try {
    const supabase = await createClient();
    const { data } = await timed("unread", () => rpc<number>(supabase, "my_unread_count"));
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}
