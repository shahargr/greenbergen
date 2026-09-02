import { createClient } from "@/lib/supabase/server";
import { InviteBuilder } from "./InviteBuilder";

export default async function InvitePage() {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <span className="kicker">Invite</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Invite someone</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Create an invitation link and send it however you like.
      </p>
      <InviteBuilder
        isSuperadmin={me?.is_superadmin ?? false}
        senderName={me?.full_name ?? "Someone"}
      />
    </main>
  );
}
