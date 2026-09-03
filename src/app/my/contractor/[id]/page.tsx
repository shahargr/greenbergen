import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Contract = { id: string; title: string | null; status: string; trade: string | null; amount: number | null; currency: string | null; amount_usd: number | null; awarded_date: string | null; signed_date: string | null };
type Bid = { id: string; status: string; amount: number | null; won: boolean | null; package: string | null; trade: string | null };
type Proj = {
  project_id: string; project_name: string; status: string; address: string | null; parent_name: string | null;
  seats: string[]; contracts: Contract[]; bids: Bid[]; awarded: boolean; paid_usd: number;
};
type Contractor = {
  contact: {
    id: string; name: string; company: string | null; trades: string[]; type: string | null;
    phone: string | null; phone_2: string | null; email: string | null; email_b: string | null;
    address: string | null; notes: string | null; vendor_status: string | null; vendor_code: string | null;
  };
  projects: Proj[];
};

const money = (n: number | null | undefined, cur?: string | null) =>
  n == null ? "—" : `${cur && cur !== "USD" ? `${cur} ` : "$"}${Math.round(n).toLocaleString()}`;

// One contractor: who they are, and every project they've been on. Awarded
// work shows by default; projects where they were only invited, bid, or
// held a seat without an award fold away behind ?all=1.
export default async function ContractorPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ all?: string }>;
}) {
  const { id } = await params;
  const { all } = await searchParams;
  const showAll = all === "1";
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_contractor", { p_contact: id });
  const d = (data ?? null) as Contractor | null;
  if (!d?.contact) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">This person is not on any project you can see.</p><p><Link href="/my/settings">← Settings</Link></p></main>;
  }
  const c = d.contact;
  const awarded = d.projects.filter((p) => p.awarded);
  const rest = d.projects.filter((p) => !p.awarded);
  const rows = showAll ? [...awarded, ...rest] : awarded;
  const contractLine = (p: Proj) => {
    const live = p.contracts.filter((x) => x.status.toLowerCase() !== "placeholder" && x.status.toLowerCase() !== "cancelled");
    if (live.length > 0) return live.map((x) => `${x.status}${x.amount != null ? ` · ${money(x.amount, x.currency)}` : ""}`).join(", ");
    if (p.bids.length > 0) return p.bids.map((b) => `bid ${b.status}${b.amount != null ? ` · ${money(b.amount)}` : ""}`).join(", ");
    return "—";
  };

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 760 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my/settings">← Your account</Link></p>
      <span className="kicker">Contractor</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 2px" }}>{c.name}</h1>
      <p className="muted small" style={{ margin: "0 0 12px" }}>
        {[c.company, c.trades.length ? c.trades.join(", ") : c.type, c.vendor_status].filter(Boolean).join(" · ") || "No trade recorded"}
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "grid", gap: 6 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Contact</h2>
          <div className="small" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Phone</div>
              <div>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : "—"}{c.phone_2 && <> · <a href={`tel:${c.phone_2}`}>{c.phone_2}</a></>}</div></div>
            <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Email</div>
              <div>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : "—"}{c.email_b && <> · <a href={`mailto:${c.email_b}`}>{c.email_b}</a></>}</div></div>
            {c.address && <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Address</div><div>{c.address}</div></div>}
            {c.vendor_code && <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>Vendor code</div><div>{c.vendor_code}</div></div>}
          </div>
          {c.notes && <p className="muted small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.notes}</p>}
        </div>

        <div className="card" style={{ display: "grid", gap: 6, overflowX: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Projects · {awarded.length} awarded{showAll ? ` · ${rest.length} other` : ""}</h2>
            {rest.length > 0 && (
              showAll
                ? <Link href={`/my/contractor/${id}`} className="small">Awarded only</Link>
                : <Link href={`/my/contractor/${id}?all=1`} className="small">Show {rest.length} not awarded</Link>
            )}
          </div>
          {rows.length === 0 && <p className="muted small" style={{ margin: 0 }}>{awarded.length === 0 && rest.length > 0 ? "No awarded work yet." : "No projects yet."}</p>}
          {rows.length > 0 && (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead><tr><th>Project</th><th>Status</th><th>Role</th><th>Contract</th><th style={{ textAlign: "right" }}>Paid</th></tr></thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.project_id} style={p.awarded ? undefined : { opacity: 0.7 }}>
                    <td>
                      <Link href={`/my/project/${p.project_id}`} style={{ fontWeight: 600 }}>{p.project_name}</Link>
                      {p.parent_name && <div className="muted small">{p.parent_name}</div>}
                    </td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.status}</td>
                    <td className="small">{p.seats.length ? p.seats.join(", ") : <span className="muted">—</span>}</td>
                    <td className="small">{p.awarded ? "✅ " : ""}{contractLine(p)}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{p.paid_usd > 0 ? money(p.paid_usd) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </main>
  );
}
