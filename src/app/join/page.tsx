import Link from "next/link";
import { SiteHeader } from "@/components/SiteHeader";
import { createClient } from "@/lib/supabase/server";
import { JoinForm, type InvitePrefill } from "./JoinForm";

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;

  // The link is the credential: preview the invitation and pre-populate.
  let prefill: InvitePrefill | null = null;
  if (invite) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("invitation_preview", { p_token: invite });
    if (data?.ok) prefill = data as InvitePrefill;
  }

  return (
    <div className="page">
      <SiteHeader
        right={
          <Link href="/" className="iconlink" title="Home" aria-label="Home">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 10.5 12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
          </Link>
        }
      />
      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 680, paddingBottom: 64 }}>
        <h1 style={{ fontSize: 28, margin: "12px 0 4px" }}>Join Green Bergen</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          What would you like to do? Pick one — or both.
        </p>
        <JoinForm inviteToken={invite ?? null} prefill={prefill} />
      </main>
    </div>
  );
}
