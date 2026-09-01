import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/SiteHeader";
import { signOut } from "@/app/my/actions";

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

const OwnerIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

const ContractorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m14.5 9.5 6 6L18 18l-6-6" />
    <path d="M3.3 6.8 6 4l4.4 4.4a2 2 0 0 1 0 2.8l-.2.2a2 2 0 0 1-2.8 0z" />
    <path d="m5 21 5.5-5.5" />
  </svg>
);

const AdminIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3 4 6v5c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z" />
  </svg>
);

export type NavRole = "Owner" | "Contractor" | "Admin";

const ROLE_ICON: Record<NavRole, () => React.ReactNode> = {
  Owner: OwnerIcon,
  Contractor: ContractorIcon,
  Admin: AdminIcon,
};

const ROLE_HOME: Record<NavRole, string> = {
  Owner: "/my",
  Contractor: "/contractor",
  Admin: "/admin",
};

// The signed-in top menu: role switcher on the left, icon utilities on the
// right. Roles: Owner and Contractor for everyone (their surfaces gate
// themselves), Admin for a superadmin.
export async function TopNav({ role = "Owner" }: { role?: NavRole }) {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  const roles: NavRole[] = me?.is_superadmin
    ? ["Owner", "Contractor", "Admin"]
    : ["Owner", "Contractor"];
  const CurrentIcon = ROLE_ICON[role];

  return (
    <header className="topnav">
      <nav className="wrap topnav-inner">
        <div className="topnav-left" style={{ display: "inline-flex", alignItems: "center", gap: 16 }}>
          <Wordmark small href={ROLE_HOME[role]} />
          <details className="rolemenu">
            <summary><span className="rolemenu-current"><CurrentIcon /> {role} ▾</span></summary>
            <div className="rolemenu-list">
              {roles.map((r) => {
                const Icon = ROLE_ICON[r];
                return r === role ? (
                  <span key={r} className="rolemenu-item current"><Icon /> {r}</span>
                ) : (
                  <Link key={r} className="rolemenu-item" href={ROLE_HOME[r]}><Icon /> {r}</Link>
                );
              })}
            </div>
          </details>
        </div>
        <div className="topnav-right">
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
