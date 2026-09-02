import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/SiteHeader";
import { signOut } from "@/app/my/actions";
import { VIEW_HOME } from "@/components/viewmap";
import { MaskMenu } from "@/components/MaskMenu";

const HomeIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

const InviteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21c0-3.6 3.1-6 7-6 1.2 0 2.3.2 3.3.6" />
    <path d="M19 8v8" />
    <path d="M15 12h8" />
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
  const [{ data: me }, jar] = await Promise.all([supabase.rpc("me"), cookies()]);

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
            <span className="brand-viewfor">{viewLabel}</span>
          </span>
        </div>
        <div className="topnav-right">
          {isAdmin && <MaskMenu views={views} current={viewLabel} />}
          <Link href={ROLE_HOME[role]} className="iconlink" title="Home" aria-label="Home"><HomeIcon /></Link>
          <Link href="/my/invite" className="iconlink" title="Invite" aria-label="Invite"><InviteIcon /></Link>
          <Link href="/my/settings" className="iconlink" title="Settings" aria-label="Settings"><SettingsIcon /></Link>
          <form action={signOut} style={{ display: "inline-flex" }}>
            <button className="iconlink" title="Sign out" aria-label="Sign out"><SignOutIcon /></button>
          </form>
        </div>
      </nav>
    </header>
  );
}
