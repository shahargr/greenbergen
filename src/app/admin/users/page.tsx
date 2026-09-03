import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { beginViewAs } from "@/components/viewas";
import {
  vendorDecision,
  toggleAccount,
  cancelInvitation,
  assignUser,
  createProjectAdmin,
  renameProject,
  saveParty,
  deleteParty,
} from "./actions";

export const dynamic = "force-dynamic";

// Outside the component: the purity lint is right that clocks do not belong
// in render. The page is force-dynamic, so per-request freshness holds.
function weekAgoIso() {
  return new Date(Date.now() - 7 * 86400000).toISOString();
}

type Stat = { label: string; value: number };

// The admin console for people: vendor approvals, accounts, invitations,
// seating users on projects, projects themselves, and the contact book.
export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; saved?: string; error?: string }>;
}) {
  const { q, saved, error } = await searchParams;
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  if (!me?.is_superadmin) {
    return (
      <main className="wrap" style={{ paddingTop: 48, maxWidth: 560 }}>
        <h1>User management</h1>
        <p className="muted">This area is for administrators.</p>
        <Link href="/">&larr; Back home</Link>
      </main>
    );
  }

  const count = (table: string, filter?: (b: ReturnType<ReturnType<typeof supabase.from>["select"]>) => unknown) => {
    let b = supabase.from(table).select("*", { count: "exact", head: true });
    if (filter) b = filter(b) as typeof b;
    return b.then((r) => r.count ?? 0);
  };

  const [
    users, contacts, companies, projects, pendingInvites, vendorRequests, inquiries7d, openTasks,
    vendorRows, accountRows, inviteRows, projectRows, roleRows, userRows,
  ] = await Promise.all([
    count("app_users"),
    count("contacts"),
    count("companies"),
    count("projects"),
    count("app_invitations", (b) => b.eq("status", "pending")),
    count("contacts", (b) => b.eq("vendor_status", "applied")),
    count("project_inquiries", (b) => b.gte("created_at", weekAgoIso())),
    count("actions", (b) => b.not("status", "in", "(Completed,Cancelled,Force Cancelled)")),
    supabase
      .from("contacts")
      .select("id, name, phone, email_a, vendor_code, created_at, companies(company_name)")
      .eq("vendor_status", "applied")
      .order("created_at", { ascending: true }),
    supabase
      .from("app_users")
      .select("id, email, full_name, is_active, is_superadmin, created_at")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("app_invitations")
      .select("id, email, token, status, expires_at, uses, max_uses, can_create_projects, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(25),
    supabase
      .from("projects")
      .select("id, project_name, address, status, owner_user_id, is_template")
      .is("trashed_at", null)
      .order("project_name"),
    supabase.from("project_roles").select("role, authority_rank").order("authority_rank", { ascending: false }),
    supabase.from("app_users").select("id, email, full_name").eq("is_active", true).order("email"),
  ]);

  // Owner email per project, for the assign picker ("owner email - project").
  type ProjRow = { id: string; project_name: string; address: string | null; status: string; owner_user_id: string | null; is_template: boolean | null };
  const projList = ((projectRows.data ?? []) as ProjRow[]).filter((p) => !p.is_template);
  const ownerIds = [...new Set(projList.map((p) => p.owner_user_id).filter((x): x is string => !!x))];
  const { data: ownerRows } = ownerIds.length
    ? await supabase.from("app_users").select("id, email").in("id", ownerIds)
    : { data: [] as { id: string; email: string | null }[] };
  const ownerEmail = new Map(((ownerRows ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email ?? ""]));
  // The eight seats the picker offers, in Shahar's order.
  const SEATS = ["GC", "Contractor", "Viewer", "Project manager", "Inspector", "Consultant", "Investor", "Maintenance manager"];

  const stats: Stat[] = [
    { label: "Accounts", value: users },
    { label: "Contacts", value: contacts },
    { label: "Companies", value: companies },
    { label: "Projects", value: projects },
    { label: "Open invitations", value: pendingInvites },
    { label: "Vendor requests", value: vendorRequests },
    { label: "Inquiries · 7d", value: inquiries7d },
    { label: "Open tasks", value: openTasks },
  ];

  // Contact-book search.
  const query = (q ?? "").trim();
  const [foundContacts, foundCompanies] = query
    ? await Promise.all([
        supabase
          .from("contacts")
          .select("id, name, phone, email_a")
          .or(`name.ilike.%${query}%,email_a.ilike.%${query}%,phone.ilike.%${query}%`)
          .limit(8),
        supabase
          .from("companies")
          .select("id, company_name, main_phone, main_email")
          .ilike("company_name", `%${query}%`)
          .limit(8),
      ])
    : [{ data: [] }, { data: [] }];

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 14px" }}>User management</h1>
      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Done ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div className="youband" style={{ marginBottom: 16 }}>
        {stats.map((s) => (
          <span key={s.label} className="card stat">
            <span className="stat-kicker">{s.label}</span>
            <span className="stat-big">{s.value}</span>
          </span>
        ))}
      </div>

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card">
          <h2 className="section-title">Contractor requests · {vendorRequests}</h2>
          {(vendorRows.data ?? []).length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing pending.</p>}
          <div style={{ display: "grid", gap: 8 }}>
            {(vendorRows.data ?? []).map((v) => {
              const co = v.companies as unknown as { company_name: string | null } | null;
              return (
                <div key={v.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span>
                    <strong>{co?.company_name ?? v.name}</strong>
                    <span className="muted small"> · {v.name} · {v.phone ?? "no phone"} · {v.email_a ?? "no email"} · {v.vendor_code}</span>
                  </span>
                  <span className="btn-row">
                    <form action={vendorDecision.bind(null, v.id, true)}>
                      <button className="btn" style={{ padding: "6px 12px" }}>Approve</button>
                    </form>
                    <form action={vendorDecision.bind(null, v.id, false)}>
                      <button className="btn ghost" style={{ padding: "6px 12px" }}>Reject</button>
                    </form>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <details className="card tradefold" open={pendingInvites > 0}>
          <summary>Pending invitations · {pendingInvites}</summary>
          <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
            {(inviteRows.data ?? []).map((i) => (
              <div key={i.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="small">
                  <strong>{i.email ?? "open link"}</strong>
                  {i.can_create_projects && <span className="muted"> · resident</span>}
                  <span className="muted"> · {i.uses}{i.max_uses ? `/${i.max_uses}` : ""} used
                  {i.expires_at ? ` · expires ${new Date(i.expires_at).toLocaleDateString()}` : " · never expires"}</span>
                  <br />
                  <code className="muted" style={{ fontSize: 11 }}>{`https://greenbergen.vercel.app/join?invite=${i.token}`}</code>
                </span>
                <form action={cancelInvitation.bind(null, i.id)}>
                  <button className="btn ghost" style={{ padding: "6px 12px" }}>Cancel</button>
                </form>
              </div>
            ))}
            {(inviteRows.data ?? []).length === 0 && <p className="muted small" style={{ margin: 0 }}>None pending.</p>}
          </div>
        </details>

        <details className="card tradefold">
          <summary>Accounts · {users}</summary>
          <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
            {(accountRows.data ?? []).map((u) => (
              <div key={u.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <span className="small">
                  <strong>{u.full_name ?? u.email}</strong>
                  <span className="muted"> · {u.email}{u.is_superadmin ? " · admin" : ""}{u.is_active ? "" : " · SUSPENDED"}</span>
                </span>
                {u.is_active && !u.is_superadmin && (
                  <form action={beginViewAs.bind(null, u.id)}>
                    <button className="btn ghost" style={{ padding: "6px 12px" }}>👁 View as</button>
                  </form>
                )}
                <form action={toggleAccount.bind(null, u.id, !u.is_active)}>
                  <button className={u.is_active ? "btn ghost" : "btn"} style={{ padding: "6px 12px" }}>
                    {u.is_active ? "Suspend" : "Resume"}
                  </button>
                </form>
              </div>
            ))}
          </div>
        </details>

        <details className="card tradefold">
          <summary>Assign a user to a project</summary>
          <form action={assignUser} className="btn-row" style={{ paddingTop: 10 }}>
            <select name="user" className="input" required style={{ maxWidth: 220 }}>
              <option value="">User…</option>
              {(userRows.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>
              ))}
            </select>
            <select name="project" className="input" required style={{ maxWidth: 300 }}>
              <option value="">Project…</option>
              {projList.map((p) => (
                <option key={p.id} value={p.id}>
                  {(p.owner_user_id && ownerEmail.get(p.owner_user_id)) || "no owner"} - {p.project_name}
                </option>
              ))}
            </select>
            {/* One picker: the seat. The membership role is derived from it server-side. */}
            <select name="seat" className="input" required defaultValue="" style={{ maxWidth: 200 }} aria-label="Assigned as">
              <option value="" disabled>Assigned as…</option>
              {SEATS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <button className="btn">Seat them</button>
          </form>
        </details>

        <details className="card tradefold">
          <summary>Projects · {projects}</summary>
          <div style={{ display: "grid", gap: 8, paddingTop: 8 }}>
            <form action={createProjectAdmin} className="btn-row">
              <input name="name" className="input" placeholder="New project name" required style={{ maxWidth: 220 }} />
              <input name="address" className="input" placeholder="Address (optional)" style={{ maxWidth: 240 }} />
              <button className="btn">Create</button>
            </form>
            {(projectRows.data ?? []).map((p) => (
              <form key={p.id} action={renameProject.bind(null, p.id)} className="btn-row card" style={{ padding: "8px 12px" }}>
                <input name="name" className="input" defaultValue={p.project_name} style={{ maxWidth: 260 }} />
                <span className="muted small">{p.status}{p.address ? ` · ${p.address}` : ""}</span>
                <button className="btn ghost" style={{ padding: "6px 12px" }}>Rename</button>
              </form>
            ))}
          </div>
        </details>

        <div className="card">
          <h2 className="section-title">Contacts &amp; companies</h2>
          <form className="btn-row" style={{ marginBottom: 10 }}>
            <input name="q" className="input" placeholder="Search name, email or phone…" defaultValue={query} style={{ maxWidth: 300 }} />
            <button className="btn ghost">Search</button>
          </form>
          {query && (
            <div style={{ display: "grid", gap: 8 }}>
              {(foundContacts.data ?? []).map((c) => (
                <div key={c.id} className="card" style={{ padding: "10px 14px", display: "grid", gap: 8 }}>
                  <span className="stat-kicker">Contact</span>
                  <form action={saveParty.bind(null, "contact", c.id)} className="btn-row">
                    <input name="name" className="input" defaultValue={c.name ?? ""} style={{ maxWidth: 200 }} />
                    <input name="phone" className="input" defaultValue={c.phone ?? ""} placeholder="Phone" style={{ maxWidth: 160 }} />
                    <input name="email" className="input" defaultValue={c.email_a ?? ""} placeholder="Email" style={{ maxWidth: 220 }} />
                    <button className="btn ghost" style={{ padding: "6px 12px" }}>Save</button>
                  </form>
                  <form action={deleteParty.bind(null, "contact", c.id)}>
                    <button className="btn ghost" style={{ padding: "4px 10px", color: "#a03a2b", borderColor: "#a03a2b" }}>
                      Delete (only where safe)
                    </button>
                  </form>
                </div>
              ))}
              {(foundCompanies.data ?? []).map((c) => (
                <div key={c.id} className="card" style={{ padding: "10px 14px", display: "grid", gap: 8 }}>
                  <span className="stat-kicker">Company</span>
                  <form action={saveParty.bind(null, "company", c.id)} className="btn-row">
                    <input name="name" className="input" defaultValue={c.company_name ?? ""} style={{ maxWidth: 200 }} />
                    <input name="phone" className="input" defaultValue={c.main_phone ?? ""} placeholder="Phone" style={{ maxWidth: 160 }} />
                    <input name="email" className="input" defaultValue={c.main_email ?? ""} placeholder="Email" style={{ maxWidth: 220 }} />
                    <button className="btn ghost" style={{ padding: "6px 12px" }}>Save</button>
                  </form>
                  <form action={deleteParty.bind(null, "company", c.id)}>
                    <button className="btn ghost" style={{ padding: "4px 10px", color: "#a03a2b", borderColor: "#a03a2b" }}>
                      Delete (only where safe)
                    </button>
                  </form>
                </div>
              ))}
              {(foundContacts.data ?? []).length === 0 && (foundCompanies.data ?? []).length === 0 && (
                <p className="muted small" style={{ margin: 0 }}>No matches for &ldquo;{query}&rdquo;.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
