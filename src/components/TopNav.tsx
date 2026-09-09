import Link from "next/link";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getMe } from "@/lib/serverMe";
import { Wordmark } from "@/components/SiteHeader";
import { signOut } from "@/app/my/actions";
import { VIEW_HOME } from "@/components/viewmap";
import { MaskMenu, type Person } from "@/components/MaskMenu";
import { BackNav } from "@/components/BackNav";
import { NavRole } from "@/components/NavRole";
import { seatLabel } from "@/lib/seatLabel";
import { endViewAs, beginViewAs } from "@/components/viewas";

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

const DoorsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" />
    <rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
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
  const [me, { data: borrowed }, { data: canActData }, { data: realIdData }, jar, hdrs, { data: invites }] = await Promise.all([
    getMe(),
    supabase.rpc("borrowed_seat"),
    supabase.rpc("borrowed_can_act"),
    supabase.rpc("real_app_user_id"),
    cookies(),
    headers(),
    supabase.rpc("portal_my_invites"),
  ]);
  const canAct = canActData === true;
  const realId = typeof realIdData === "string" ? realIdData : null;
  // Where to come back to after a switch: the page being looked at, minus
  // any flash it was carrying (an old ?error= must not follow the switch).
  const here = (() => {
    const raw = hdrs.get("x-pathname") ?? "/my";
    const [path, qs] = raw.split("?");
    const q = new URLSearchParams(qs ?? "");
    for (const k of ["error", "ok", "saved"]) q.delete(k);
    const rest = q.toString();
    return rest ? `${path}?${rest}` : path;
  })();
  // Things waiting on you: invitations to answer, and answers to yours.
  const { data: msgPending } = await supabase.rpc("portal_my_messages_pending");
  const waitingMessages = typeof msgPending === "number" ? msgPending : 0;
  const inbound = ((invites?.incoming ?? []) as unknown[]).length
    + ((invites?.outcomes ?? []) as unknown[]).length
    + waitingMessages;

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
  // While borrowed, me() is the borrowed person - but a borrowed seat can
  // only exist for a real administrator, so the mask stays available.
  const realAdmin = isAdmin || !!borrowed;
  const picked = isAdmin ? jar.get("gb_view")?.value : undefined;
  const viewLabel = picked && VIEW_HOME[picked] === ROLE_HOME[role] ? picked : role;
  const views = [...ALL_VIEWS];

  // The people an administrator can become: everyone holding a seat with a
  // login, once each, with their highest seat as the hint.
  type Target = { project_id: string; name: string; seats: { app_user_id: string; name: string; project_role: string | null; role: string; rank: number }[] };
  const { data: targetData } = realAdmin ? await supabase.rpc("admin_view_targets") : { data: null };
  const people: Person[] = [];
  {
    const best = new Map<string, { name: string; rank: number; hint: string }>();
    for (const t of ((targetData ?? []) as Target[])) {
      for (const st of t.seats ?? []) {
        const hint = `${st.project_role ?? st.role} · ${t.name}`;
        const cur = best.get(st.app_user_id);
        if (!cur || st.rank > cur.rank) best.set(st.app_user_id, { name: st.name, rank: st.rank, hint });
      }
    }
    for (const [id, v] of best) people.push({ id, name: v.name, hint: v.hint });
    people.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <header className="topnav">
      <nav className="wrap topnav-inner">
        <div className="topnav-left">
          {/* The seat you hold IS the line under the logo now - MY HOME,
              PROJECT M., CONTRACTOR, VISITOR, ADMIN - one word, in the
              lockup. Name, email and "(N roles)" moved to the tooltip. */}
          <span className="brandstack" title={me?.email ? `${firstName} · ${me.email} · ${whoLabel}${isAdmin ? ` · viewing as ${viewLabel}` : ""}` : undefined}>
            <Wordmark small href={ROLE_HOME[role]}
              door={me?.email
                // A trade with no project seat yet is still a contractor, not a visitor.
                ? <NavRole appUserId={me?.app_user_id ?? null} ranks={ranksObj} admin={isAdmin}
                    fallback={seatNames.length === 0 && tradeNames.length > 0 && !isAdmin ? "Contractor" : seatLabel(seatNames, ranksObj, isAdmin)} />
                : seatLabel([], {}, false)} />
          </span>
        </div>
        <div className="topnav-right">
          {realAdmin && <MaskMenu views={views} current={viewLabel} email={me?.email ?? undefined}
            people={people} borrowed={borrowed ? { id: String(borrowed), canAct } : null} here={here} selfId={realId} />}
          <BackNav />
          <Link href="/my/inbox" className="iconlink"
            title={inbound > 0
              ? `${inbound} waiting on you${waitingMessages > 0 ? ` · ${waitingMessages} message${waitingMessages === 1 ? "" : "s"} to review` : ""}`
              : "Inbox"}
            aria-label="Inbox"
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
          {/* Switch door: the same picker /after-login uses. Next to Sign out
              because they are the two ways to stop being here as this hat. */}
          <Link href="/choose" className="iconlink" title="Switch door" aria-label="Switch door"><DoorsIcon /></Link>
          <form action={signOut} style={{ display: "inline-flex" }}>
            <button className="iconlink" title="Sign out" aria-label="Sign out"><SignOutIcon /></button>
          </form>
        </div>
      </nav>
      {borrowed && (
        <div style={{ background: canAct ? "#7a1f2b" : "#c0262d", color: "#fff", fontSize: 13, padding: "6px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span>
            {canAct
              ? <>⚡ Acting as <strong>{me?.full_name ?? me?.email}</strong> — every change lands as them, logged with your name behind it.</>
              : <>👁 Viewing as <strong>{me?.full_name ?? me?.email}</strong> — their eyes only; changes are refused.</>}
            <span style={{ opacity: 0.8 }}> Expires in an hour.</span>
          </span>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {!canAct && (
              <form action={beginViewAs.bind(null, String(borrowed), true, here)}>
                <button className="btn small" style={{ background: "#fff", color: "#7a1f2b", border: 0 }}>⚡ Act as them</button>
              </form>
            )}
            <form action={endViewAs.bind(null, here)}>
              <button className="btn small" style={{ background: "transparent", color: "#fff", border: "1px solid #fff" }}>↩ Return to myself</button>
            </form>
          </span>
        </div>
      )}
    </header>
  );
}
