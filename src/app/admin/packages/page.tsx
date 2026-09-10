import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { savePackage } from "./actions";

export const dynamic = "force-dynamic";

// THE CATALOGUE, FROM THE INSIDE. Shahar: "i need an interface under admin
// to edit those." One row per package - what it is, what it goes out at,
// whether anyone can serve it - and a way to start a new one. Everything
// else is on the package's own page.
type Row = {
  code: string; name: string; tile_title: string; trade: string; availability: string;
  base_price_cents: number | null; is_active: boolean; sort_order: number; tile_group: string;
  category: string | null; covered: boolean; items: number; levers: number; servers: number;
  promote: boolean; has_photo: boolean;
  last_modified_at: string | null; last_modified_by: string | null;
};

const money = (c: number | null) => (c == null ? "—" : `$${(c / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const AVAIL: Record<string, string> = { priced: "Priced", coming_soon: "Coming soon", quote: "Quote", custom: "Custom" };

export default async function AdminPackagesPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data }, { data: trades }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("admin_packages"),
    supabase.from("trades").select("trade").order("sort_order"),
  ]);
  if (!me?.is_superadmin) {
    return (
      <main className="wrap" style={{ paddingTop: 48, maxWidth: 560 }}>
        <h1>Packages</h1><p className="muted">This area is for administrators.</p><Link href="/">&larr; Back home</Link>
      </main>
    );
  }
  const rows = (Array.isArray(data) ? data : []) as Row[];
  const live = rows.filter((r) => r.is_active);
  const retired = rows.filter((r) => !r.is_active);

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Packages</h1>
      <p className="muted" style={{ marginTop: 0, maxWidth: 640 }}>
        Every package is a <strong>basic setup</strong> at one price - services and hardware together - plus
        <strong> levers</strong>: the questions whose answers add an upgrade at its cost, or take one away.
        The homeowner apps read this live; the grid picks changes up within five minutes.
      </p>
      {error && <p className="card" style={{ borderLeft: "4px solid #c0262d" }}>{error}</p>}
      {saved && <p className="card" style={{ borderLeft: "4px solid var(--brand)" }}>{saved}</p>}

      <div className="card" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tasktable">
          <thead>
            <tr><th>Package</th><th>Trade</th><th>State</th><th style={{ textAlign: "right" }}>Basic setup</th><th style={{ textAlign: "right" }}>Levers</th><th style={{ textAlign: "right" }}>Serving</th><th></th></tr>
          </thead>
          <tbody>
            {live.map((r) => (
              <tr key={r.code}>
                <td><Link href={`/admin/packages/${r.code}`}><strong>{r.name}</strong></Link><br /><span className="muted small">{r.tile_title} · {r.tile_group === "front" ? "front page" : "more"} · order {r.sort_order}{r.promote && <> · <strong>on the landing page</strong>{!r.has_photo && " (no photo yet)"}</>}</span></td>
                <td>{r.trade}{!r.covered && <><br /><span className="small" style={{ color: "#c0262d" }}>nobody approved carries it</span></>}</td>
                <td>{AVAIL[r.availability] ?? r.availability}</td>
                <td style={{ textAlign: "right" }}>{money(r.base_price_cents)}</td>
                <td style={{ textAlign: "right" }}>{r.levers}<span className="muted small"> · {r.items} lines</span></td>
                <td style={{ textAlign: "right" }}>{r.servers}</td>
                <td><Link href={`/admin/packages/${r.code}`} className="btn ghost">Edit</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {retired.length > 0 && (
        <details className="card" style={{ marginTop: 14 }}>
          <summary className="muted">Retired · {retired.length}</summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
            {retired.map((r) => <li key={r.code}><Link href={`/admin/packages/${r.code}`}>{r.name}</Link> <span className="muted small">{r.trade}</span></li>)}
          </ul>
        </details>
      )}

      <div className="card" style={{ marginTop: 18, maxWidth: 640 }}>
        <h2 className="section-title">New package</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          It starts as <em>coming soon</em> on the More shelf. Set the basic setup, the scope lines and the levers on its page, then switch it to Priced.
        </p>
        <form action={savePackage} style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
          <input type="hidden" name="new" value="1" />
          <label className="field" style={{ margin: 0 }}><span className="muted small">Code (lowercase, underscores)</span><input className="input" name="code" required pattern="[a-z0-9_]{2,40}" placeholder="pergola" /></label>
          <label className="field" style={{ margin: 0 }}><span className="muted small">Trade</span>
            <select className="input" name="trade" required defaultValue="">
              <option value="" disabled>Pick a trade</option>
              {(trades ?? []).map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}
            </select>
          </label>
          <label className="field" style={{ margin: 0 }}><span className="muted small">Name</span><input className="input" name="name" required placeholder="Pergola" /></label>
          <label className="field" style={{ margin: 0 }}><span className="muted small">Tile title</span><input className="input" name="tile_title" required placeholder="Pergola" /></label>
          <div style={{ gridColumn: "1 / -1" }}><button className="btn">Create the package</button></div>
        </form>
      </div>
    </main>
  );
}
