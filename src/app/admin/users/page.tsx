import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { beginViewAs } from "@/components/viewas";
import {
  vendorDecision,
  setActive,
  setTrades,
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
    vendorRows, accountRows, inviteRows, projectRows, roleRows, userRows, tradeList,
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
      .select("id, email, full_name, is_active, is_superadmin, created_at, contact_id, login_count, last_login_at, disabled_reason")
      .order("created_at", { ascending: false })
      .limit(500),
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
    supabase.from("trades").select("trade").eq("is_worker_trade", true).order("sort_order"),
  ]);
  const TRADES = ((tradeList.data ?? []) as { trade: string }[]).map((t) => t.trade);

  // Owner email per project, for the assign picker ("owner email - project").
  type ProjRow = { id: string; project_name: string; address: string | null; status: string; owner_user_id: string | null; is_template: boolean | null };
  const projList = ((projectRows.data ?? []) as ProjRow[]).filter((p) => !p.is_template);
  const ownerIds = [...new Set(projList.map((p) => p.owner_user_id).filter((x): x is string => !!x))];
  const { data: ownerRows } = ownerIds.length
    ? await supabase.from("app_users").select("id, email").in("id", ownerIds)
    : { data: [] as { id: string; email: string | null }[] };
  const ownerEmail = new Map(((ownerRows ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email ?? ""]));

  // Who each account IS, read from the data rather than a typed label:
  //   admin      - is_superadmin
  //   homeowner  - owns a home, or sits as asset owner anywhere
  //   contractor - holds a trade, or a site seat below project management
  //   other      - signed up, nothing yet (an invitee, a viewer)
  type Account = { id: string; email: string | null; full_name: string | null; is_active: boolean; is_superadmin: boolean; created_at: string; contact_id: string | null; login_count: number | null; last_login_at: string | null; disabled_reason: string | null };
  const accounts = ((accountRows.data ?? []) as Account[]);
  const contactIds = accounts.map((a) => a.contact_id).filter((x): x is string => !!x);
  type ContactRow = { id: string; name: string | null; phone: string | null; email_a: string | null };
  const [{ data: seatRowsAll }, { data: tradeRowsAll }, { data: contactRowsAll }] = await Promise.all([
    supabase.from("project_members").select("app_user_id, role, project_role").eq("status", "active").not("app_user_id", "is", null).limit(5000),
    contactIds.length ? supabase.from("contact_trade_roles").select("contact_id, trade").in("contact_id", contactIds) : Promise.resolve({ data: [] as { contact_id: string; trade: string }[] }),
    contactIds.length ? supabase.from("contacts").select("id, name, phone, email_a").in("id", contactIds) : Promise.resolve({ data: [] as ContactRow[] }),
  ]);
  const contactOf = new Map(((contactRowsAll ?? []) as ContactRow[]).map((c) => [c.id, c]));
  const rankOf = new Map(((roleRows.data ?? []) as { role: string; authority_rank: number | null }[]).map((r) => [r.role, r.authority_rank ?? 0]));
  const seatsOf = new Map<string, string[]>();
  for (const r of ((seatRowsAll ?? []) as { app_user_id: string; role: string; project_role: string | null }[])) {
    const list = seatsOf.get(r.app_user_id) ?? [];
    const seat = r.project_role ?? r.role;
    if (!list.includes(seat)) list.push(seat);
    seatsOf.set(r.app_user_id, list);
  }
  const tradesOf = new Map<string, string[]>();
  for (const r of ((tradeRowsAll ?? []) as { contact_id: string; trade: string }[])) {
    const list = tradesOf.get(r.contact_id) ?? [];
    if (!list.includes(r.trade)) list.push(r.trade);
    tradesOf.set(r.contact_id, list);
  }
  const homesOf = new Map<string, number>();
  for (const p of projList) if (p.owner_user_id && p.status === "In Progress") homesOf.set(p.owner_user_id, (homesOf.get(p.owner_user_id) ?? 0) + 1);
  type AccountType = "admin" | "homeowner" | "contractor" | "other";
  const typeOf = (a: Account): AccountType => {
    if (a.is_superadmin) return "admin";
    const seats = seatsOf.get(a.id) ?? [];
    if ((homesOf.get(a.id) ?? 0) > 0 || seats.includes("asset owner")) return "homeowner";
    const trades = a.contact_id ? tradesOf.get(a.contact_id) ?? [] : [];
    if (trades.length > 0 || seats.some((st) => (rankOf.get(st) ?? 0) > 0 && (rankOf.get(st) ?? 0) < 50)) return "contractor";
    return "other";
  };
  const TYPES: { key: AccountType; label: string; note: string }[] = [
    { key: "homeowner", label: "Homeowners", note: "Own a home on the platform" },
    { key: "contractor", label: "Contractors", note: "Hold a trade or a site seat" },
    { key: "admin", label: "Administrators", note: "Full platform rights" },
    { key: "other", label: "Signed up, nothing yet", note: "No home, no trade, no seat" },
  ];
  // One search box for people: it narrows the accounts below AND the contact
  // book at the bottom. Name, email, phone, or a trade they hold.
  const query = (q ?? "").trim();
  const needle = query.toLowerCase();
  const matches = (a: Account) => {
    if (!needle) return true;
    const c = a.contact_id ? contactOf.get(a.contact_id) : null;
    const hay = [a.full_name, a.email, c?.name, c?.phone, c?.email_a, ...(a.contact_id ? tradesOf.get(a.contact_id) ?? [] : [])]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(needle);
  };
  const activeAccounts = accounts.filter((a) => a.is_active && matches(a));
  const suspended = accounts.filter((a) => !a.is_active && matches(a));
  const byType = new Map<AccountType, Account[]>();
  for (const a of activeAccounts) { const t = typeOf(a); byType.set(t, [...(byType.get(t) ?? []), a]); }
  const fmtWhen = (d: string | null) => d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "never";
  // One account, and behind "Edit" everything an administrator does to a
  // person: contact details, the trades they hold, and the switch - off with a
  // reason, on again. View-as and act-as stay where they were.
  const accountRow = (u: Account) => {
    const seats = seatsOf.get(u.id) ?? [];
    const trades = u.contact_id ? tradesOf.get(u.contact_id) ?? [] : [];
    const homes = homesOf.get(u.id) ?? 0;
    const contact = u.contact_id ? contactOf.get(u.contact_id) ?? null : null;
    const facts = [
      homes > 0 ? `${homes} home${homes === 1 ? "" : "s"}` : null,
      trades.length > 0 ? trades.join(", ") : null,
      seats.length > 0 ? seats.join(", ") : null,
    ].filter(Boolean).join(" · ");
    return (
      <details key={u.id} className="card" style={{ padding: "10px 14px" }}>
        <summary style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", cursor: "pointer", listStyle: "none" }}>
          <span className="small" style={{ minWidth: 0 }}>
            <strong>{u.full_name ?? u.email}</strong>
            <span className="muted"> · {u.email}{u.is_active ? "" : " · OFF"}</span>
            <br />
            <span className="muted">
              {u.login_count ?? 0} login{(u.login_count ?? 0) === 1 ? "" : "s"} · last {fmtWhen(u.last_login_at)} · joined {fmtWhen(u.created_at)}
              {facts ? ` · ${facts}` : ""}
              {!u.is_active && u.disabled_reason ? ` · off because: ${u.disabled_reason}` : ""}
            </span>
          </span>
          <span style={{ display: "inline-flex", gap: 6, flexWrap: "wrap" }}>
            {u.is_active && !u.is_superadmin && (
              <>
                <form action={beginViewAs.bind(null, u.id, false, "/my")}>
                  <button className="btn ghost" style={{ padding: "6px 12px" }} title="Their eyes only; changes refused">👁 View as</button>
                </form>
                <form action={beginViewAs.bind(null, u.id, true, "/my")}>
                  <button className="btn" style={{ padding: "6px 12px" }} title="Their hands too; every change is logged with your name behind it">⚡ Act as</button>
                </form>
              </>
            )}
            <span className="btn ghost" style={{ padding: "6px 12px" }}>Edit ▾</span>
          </span>
        </summary>

        <div style={{ display: "grid", gap: 12, paddingTop: 12, borderTop: "1px solid var(--line)", marginTop: 10 }}>
          {contact ? (
            <div>
              <span className="stat-kicker">Contact</span>
              <form action={saveParty.bind(null, "contact", contact.id)} className="btn-row" style={{ marginTop: 6 }}>
                <input name="name" className="input" defaultValue={contact.name ?? ""} placeholder="Name" style={{ maxWidth: 200 }} />
                <input name="phone" className="input" defaultValue={contact.phone ?? ""} placeholder="Phone" style={{ maxWidth: 160 }} />
                <input name="email" className="input" defaultValue={contact.email_a ?? ""} placeholder="Email" style={{ maxWidth: 220 }} />
                <button className="btn ghost" style={{ padding: "6px 12px" }}>Save contact</button>
              </form>
            </div>
          ) : (
            <p className="muted small" style={{ margin: 0 }}>No contact card behind this account yet - it is created the first time they add a home or register a trade.</p>
          )}

          {contact && (
            <div>
              <span className="stat-kicker">Trades</span>
              <form action={setTrades.bind(null, contact.id)} style={{ marginTop: 6 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", maxHeight: 180, overflowY: "auto", padding: "4px 0" }}>
                  {TRADES.map((t) => (
                    <label key={t} className="small" style={{ display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}>
                      <input type="checkbox" name="trade" value={t} defaultChecked={trades.includes(t)} /> {t}
                    </label>
                  ))}
                </div>
                <button className="btn ghost" style={{ padding: "6px 12px", marginTop: 6 }}>Save trades</button>
              </form>
            </div>
          )}

          {!u.is_superadmin && (
            <div>
              <span className="stat-kicker">{u.is_active ? "Switch off" : "Switch on"}</span>
              {u.is_active ? (
                <form action={setActive.bind(null, u.id, false)} className="btn-row" style={{ marginTop: 6 }}>
                  <input name="note" className="input" placeholder="Why - one line, kept on the record" required style={{ maxWidth: 360 }} />
                  <button className="btn ghost" style={{ padding: "6px 12px", color: "#a03a2b", borderColor: "#a03a2b" }}>Switch off</button>
                </form>
              ) : (
                <form action={setActive.bind(null, u.id, true)} className="btn-row" style={{ marginTop: 6 }}>
                  <span className="muted small">Off{u.disabled_reason ? ` - ${u.disabled_reason}` : ""}.</span>
                  <button className="btn" style={{ padding: "6px 12px" }}>Switch on</button>
                </form>
              )}
            </div>
          )}
        </div>
      </details>
    );
  };
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

  // Contact-book search, same query.
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

      <form className="btn-row" style={{ marginBottom: 14 }}>
        <input name="q" className="input" placeholder="Find a person: name, email, phone or trade…" defaultValue={query} style={{ maxWidth: 420 }} autoFocus />
        <button className="btn">Search</button>
        {query && <Link href="/admin/users" className="btn ghost">Clear</Link>}
      </form>

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "grid", gap: 12 }}>
          <h2 className="section-title" style={{ margin: 0 }}>{query ? `People matching "${query}" · ${activeAccounts.length}` : `Users · ${activeAccounts.length} active`}</h2>
          {query && activeAccounts.length === 0 && suspended.length === 0 && <p className="muted small" style={{ margin: 0 }}>No account matches. The contact book below may still have them.</p>}
          {TYPES.map((t) => {
            const list = byType.get(t.key) ?? [];
            if (list.length === 0) return null;
            return (
              <div key={t.key} style={{ display: "grid", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <strong>{t.label} · {list.length}</strong>
                  <span className="muted" style={{ fontSize: 11 }}>{t.note}</span>
                </div>
                {list.map(accountRow)}
              </div>
            );
          })}
          {suspended.length > 0 && (
            <details className="tradefold">
              <summary>Switched off · {suspended.length}</summary>
              <div style={{ display: "grid", gap: 6, paddingTop: 8 }}>{suspended.map(accountRow)}</div>
            </details>
          )}
        </div>

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
          {!query && <p className="muted small" style={{ margin: 0 }}>Contacts and companies without an account show up here when you search above.</p>}
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
