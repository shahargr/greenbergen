import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/serverMe";
import { Wordmark } from "@/components/SiteHeader";
import { signOut } from "@/app/my/actions";
import { VIEW_HOME } from "@/components/viewmap";
import { MaskMenu } from "@/components/MaskMenu";
import { BackNav } from "@/components/BackNav";
import { NavRole } from "@/components/NavRole";
import { endViewAs } from "@/components/viewas";

const InviteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21c0-3.6 3.1-6 7-6 1.2 0 2.3.2 3.3.6" />
    <path d="M19 8v8" />
    <path d="M15 12h8" />
  </svg>
);

const InboxIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" />
  </svg>
);

const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </svg>
);

const SignOutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

export type NavRole = "Owner" | "Contractor" | "Admin";

const ROLE_HOME: Record<NavRole, string> = {
  Owner: "/my",
  Contractor: "/contractor",
  Admin: "/admin",
};

// Every hat a view can be designed for. The ones without a surface yet are
// listed but not selectable.
const ALL_VIEWS = ["Owner", "Contractor", "PM", "GC", "Buyer", "Developer", "Viewer", "Admin"] as const;

// The signed-in top menu: brand with the view's intended hat in small red
// letters under it; utilities on the right, led by the mask - click it to
// put on a different hat.
export async function TopNav({ role = "Owner" }: { role?: NavRole }) {
  const supabase = await createClient();
  const [me, { data: borrowed }, jar, { data: invites }] = await Promise.all([
    getMe(),
    supabase.rpc("borrowed_seat"),
    cookies(),
    supabase.rpc("portal_my_invites"),
  ]);
  // Things waiting on you: invitations to answer, and answers to yours.
  const inbound = ((invites?.incoming ?? []) as unknown[]).length + ((invites?.outcomes ?? []) as unknown[]).length;

  // Who you are, under the logo: email, then your highest seat (by the
  // authority ladder) or your trade - with "(N roles)" when you hold more.
  const [{ data: seatRows }, { data: tradeRows }, { data: rankRows }] = await Promise.all([
    me?.app_user_id
      ? supabase.from("project_members").select("role, project_role").eq("app_user_id", me.app_user_id).eq("status", "active")
      : Promise.resolve({ data: [] as { role: string; project_role: string | null }[] }),
    me?.contact_id
      ? supabase.from("contact_trade_roles").select("trade").eq("contact_id", me.contact_id)
      : Promise.resolve({ data: [] as { trade: string }[] }),
    supabase.from("project_roles").select("role, authority_rank"),
  ]);
  const rankOf = new Map(((rankRows ?? []) as { role: string; authority_rank: number | null }[]).map((r) => [r.role, r.authority_rank ?? 0]));
  const seatNames = [...new Set(((seatRows ?? []) as { role: string; project_role: string | null }[]).map((s) => s.project_role ?? s.role))];
  const tradeNames = [...new Set(((tradeRows ?? []) as { trade: string }[]).map((t) => t.trade))];
  const topSeat = [...seatNames].sort((a, b) => (rankOf.get(b) ?? 0) - (rankOf.get(a) ?? 0))[0];
  const roleCount = new Set([...seatNames, ...tradeNames]).size;
  const whoLabel = (topSeat ?? tradeNames[0] ?? role) + (roleCount > 1 ? ` (${roleCount} roles)` : "");
  const firstName = (me?.full_name?.trim().split(/\s+/)[0]) || (me?.email ? me.email.split("@")[0] : "You");
  const ranksObj = Object.fromEntries(rankOf);

  // The label under the logo: the picked hat, as long as it lives on this
  // surface; otherwise the surface's own name.
  const isAdmin: boolean = me?.is_superadmin ?? false;
  const picked = isAdmin ? jar.get("gb_view")?.value : undefined;
  const viewLabel = picked && VIEW_HOME[picked] === ROLE_HOME[role] ? picked : role;
  const views = [...ALL_VIEWS];

  return (
    <header className="topnav">
      <nav className="wrap topnav-inner">
        <div className="topnav-left">
          <span className="brandstack">
            <Wordmark small href={ROLE_HOME[role]} />
            {me?.email
              ? <NavRole first={firstName} appUserId={me?.app_user_id ?? null} fallback={whoLabel} ranks={ranksObj}
                  title={`${me.email} · ${whoLabel}${isAdmin ? ` · viewing as ${viewLabel}` : ""}`} />
              : <span className="brand-viewfor">{viewLabel}</span>}
          </span>
        </div>
        <div className="topnav-right">
          {isAdmin && <MaskMenu views={views} current={viewLabel} email={me?.email ?? undefined} />}
          <BackNav />
          <Link href="/my#inbound" className="iconlink" title={inbound > 0 ? `${inbound} waiting on you` : "Inbox"} aria-label="Inbox"
            style={{ position: "relative" }}>
            <InboxIcon />
            {inbound > 0 && (
              <span aria-hidden style={{ position: "absolute", top: 2, right: 2, minWidth: 16, height: 16, padding: "0 4px", borderRadius: 8, background: "#c0262d", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: "16px", textAlign: "center" }}>
                {inbound}
              </span>
            )}
          </Link>
          <Link href="/my/invite" className="iconlink" title="Invite" aria-label="Invite"><InviteIcon /></Link>
          <Link href="/my/settings" className="iconlink" title="Settings" aria-label="Settings"><SettingsIcon /></Link>
          <form action={signOut} style={{ display: "inline-flex" }}>
            <button className="iconlink" title="Sign out" aria-label="Sign out"><SignOutIcon /></button>
          </form>
        </div>
      </nav>
      {borrowed && (
        <div style={{ background: "#c0262d", color: "#fff", fontSize: 13, padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <span>👁 Viewing as <strong>{me?.email}</strong> — their eyes, read-mostly. Expires in an hour.</span>
          <form action={endViewAs}>
            <button className="btn small" style={{ background: "#fff", color: "#c0262d", border: 0 }}>Exit view</button>
          </form>
        </div>
      )}
    </header>
  );
}
