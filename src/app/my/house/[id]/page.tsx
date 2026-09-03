import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { projectPerms } from "../../project/[id]/actions";

export const dynamic = "force-dynamic";

type Proj = { id: string; project_name: string; address: string | null; status: string; parent_project_id: string | null; created_at: string; purchase_date: string | null; purchase_amount: number | null };
type MemberRow = {
  project_id: string; role: string; project_role: string | null; contact_id: string | null;
  contacts: { name: string | null; person_name: string | null; phone: string | null; email_a: string | null } | null;
};

const CLOSED = '("Completed","Cancelled","Force Cancelled","Superseded")';
const fmt = (d: string | null) => (d ? new Date(d + (d.length === 10 ? "T12:00:00" : "")).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");

// One house: its details, the projects under it, and everyone with access.
export default async function HousePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: houseRow } = await supabase
    .from("projects")
    .select("id, project_name, address, status, parent_project_id, created_at, purchase_date, purchase_amount")
    .eq("id", id)
    .maybeSingle();
  const house = (houseRow ?? null) as Proj | null;
  if (!house) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">This house is not yours to see.</p><p><Link href="/my/settings">← Settings</Link></p></main>;
  }

  const [perms, { data: childRows }] = await Promise.all([
    projectPerms(id),
    supabase.from("projects").select("id, project_name, address, status, parent_project_id, created_at, purchase_date, purchase_amount")
      .eq("parent_project_id", id).is("trashed_at", null).eq("is_template", false).order("project_name"),
  ]);
  const projects = ((childRows ?? []) as Proj[]);
  const ids = [id, ...projects.map((p) => p.id)];

  const [{ data: openRows }, { data: memberRows }] = await Promise.all([
    supabase.from("actions").select("project_id").in("project_id", ids).not("status", "in", CLOSED).limit(5000),
    supabase.from("project_members").select("project_id, role, project_role, contact_id, contacts(name, person_name, phone, email_a)")
      .in("project_id", ids).eq("status", "active").not("contact_id", "is", null),
  ]);
  const openCount = new Map<string, number>();
  for (const r of (openRows ?? []) as { project_id: string }[]) openCount.set(r.project_id, (openCount.get(r.project_id) ?? 0) + 1);
  const nameOf = new Map<string, string>([[id, house.project_name], ...projects.map((p) => [p.id, p.project_name] as [string, string])]);

  // One row per person: their seats across the house and its projects.
  type Person = { contactId: string; name: string; phone: string | null; email: string | null; seats: Map<string, Set<string>> };
  const people = new Map<string, Person>();
  for (const m of ((memberRows ?? []) as unknown as MemberRow[])) {
    if (!m.contact_id || !m.contacts) continue;
    const p = people.get(m.contact_id) ?? {
      contactId: m.contact_id, name: m.contacts.person_name ?? m.contacts.name ?? "Unnamed",
      phone: m.contacts.phone ?? null, email: m.contacts.email_a ?? null, seats: new Map(),
    };
    const where = nameOf.get(m.project_id) ?? "—";
    const s = p.seats.get(where) ?? new Set<string>();
    s.add(m.project_role ?? m.role);
    p.seats.set(where, s);
    people.set(m.contact_id, p);
  }
  const contactIds = [...people.keys()];
  const { data: tradeRows } = contactIds.length
    ? await supabase.from("contact_trade_roles").select("contact_id, trade").in("contact_id", contactIds)
    : { data: [] };
  const tradeOf = new Map<string, string>();
  for (const r of (tradeRows ?? []) as { contact_id: string; trade: string }[]) if (!tradeOf.has(r.contact_id)) tradeOf.set(r.contact_id, r.trade);
  const peopleRows = [...people.values()].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 720 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my/settings">← Your account</Link></p>
      <span className="kicker">House</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 2px" }}>{house.project_name}</h1>
      <p className="muted small" style={{ margin: "0 0 12px" }}>{house.address ?? "No address"} · {house.status}</p>

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "grid", gap: 6 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Details</h2>
          <div className="small" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
            <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Address</div><div>{house.address ?? "—"}</div></div>
            <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Status</div><div>{house.status}</div></div>
            <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>On the platform since</div><div>{fmt(house.created_at)}</div></div>
            {perms.rank >= 70 && (house.purchase_date || house.purchase_amount) && (
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Purchased</div>
                <div>{fmt(house.purchase_date)}{house.purchase_amount ? ` · $${Number(house.purchase_amount).toLocaleString()}` : ""}</div></div>
            )}
          </div>
          <div><Link className="btn ghost small" href={`/my/project/${house.id}`}>Open the house&apos;s own page →</Link></div>
        </div>

        <div className="card" style={{ display: "grid", gap: 6, overflowX: "auto" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Projects · {projects.length}</h2>
          {projects.length === 0 && <p className="muted small" style={{ margin: 0 }}>No projects under this house yet.</p>}
          {projects.length > 0 && (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead><tr><th>Project</th><th>Status</th><th style={{ textAlign: "right" }}>Open tasks</th><th>Since</th></tr></thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/my/project/${p.id}`} style={{ fontWeight: 600 }}>{p.project_name}</Link></td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.status}</td>
                    <td style={{ textAlign: "right" }}>{openCount.get(p.id) ?? 0}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{fmt(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card" style={{ display: "grid", gap: 6, overflowX: "auto" }}>
          <h2 className="section-title" style={{ margin: 0 }}>People with access · {peopleRows.length}</h2>
          {peopleRows.length === 0 && <p className="muted small" style={{ margin: 0 }}>No one else has access yet.</p>}
          {peopleRows.length > 0 && (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead><tr><th>Name</th><th>Trade</th><th>Access</th><th>Phone</th><th>Email</th></tr></thead>
              <tbody>
                {peopleRows.map((p) => (
                  <tr key={p.contactId}>
                    <td style={{ fontWeight: 600 }}>{p.name}</td>
                    <td className="muted">{tradeOf.get(p.contactId) ?? "—"}</td>
                    <td className="small">
                      {[...p.seats.entries()].map(([where, roles]) => (
                        <div key={where}><span className="muted">{where}:</span> {[...roles].join(", ")}</div>
                      ))}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{p.phone ? <a href={`tel:${p.phone}`}>{p.phone}</a> : <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{p.email ? <a href={`mailto:${p.email}`}>{p.email}</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="muted small" style={{ margin: 0 }}>Edit anyone&apos;s details under <Link href="/my/settings">Settings → Contacts</Link>.</p>
        </div>
      </div>
    </main>
  );
}
