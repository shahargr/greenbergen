import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saveCompany, saveTerms, savePriceItem, deletePriceItem, saveBusinessDoc } from "./actions";
import { deleteCredential } from "../profile/actions";

export const dynamic = "force-dynamic";

type Company = {
  id: string; company_name: string | null; legal_name: string | null; dba: string | null;
  website: string | null; main_phone: string | null; main_email: string | null; address: string | null;
  ein: string | null; license_number: string | null;
  w9_on_file: boolean | null; w9_tax_classification: string | null; w9_signed_date: string | null;
  insurance_on_file: boolean | null; can_provide_workers_comp: boolean | null;
  can_provide_liability_insurance: boolean | null; can_provide_gc_insurance: boolean | null;
  service_zip: string | null; service_radius_miles: number | null; serves_adjacent_states: boolean | null;
};
type Settings = {
  auto_bid: boolean; auto_bid_note: string | null; net_days: number | null;
  deposit_pct: number | null; retainage_pct: number | null; invoice_email: string | null;
  preferred_payment: string | null; warranty_terms: string | null;
};
type PriceItem = {
  id: string; trade: string | null; item: string; unit: string;
  unit_price: number | null; currency: string; notes: string | null; is_active: boolean;
};
type Doc = {
  id: string; kind: string; label: string; trade: string | null; expires_on: string | null;
  file_name: string | null; bucket: string | null; path: string | null; status: string; expired: boolean;
};
type Funnel = {
  invited: number; submitted: number; won: number; lost: number; total: number;
  avg_bid: number | null; won_value: number | null;
};
type Business = {
  contact_id: string | null; company: Company | null; settings: Settings | null;
  prices: PriceItem[]; documents: Doc[]; funnel: Funnel; trades: string[]; all_trades: string[];
};

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const DOC_KINDS = [["w9", "W9"], ["insurance", "Insurance certificate"], ["warranty", "Warranty"], ["bond", "Bond"], ["tax", "Tax document"]];

// The contractor's side of account setup: the company people hire, the price
// list proposals are drafted from, how the work is won, and the paperwork an
// owner asks for before letting anyone on site.
export default async function BusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; add?: string; doc?: string }>;
}) {
  const { ok, error, add, doc } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_my_business");
  const b = (data ?? null) as Business | null;
  if (!b) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">Sign in to set up your business.</p></main>;
  }
  const co = b.company;
  const st = b.settings;
  const f = b.funnel;
  const winRate = f.submitted + f.won + f.lost > 0
    ? Math.round((f.won / (f.submitted + f.won + f.lost)) * 100) : null;
  const links = new Map<string, string>();
  await Promise.all(b.documents.filter((d) => d.bucket && d.path).map(async (d) => {
    const { data: s } = await supabase.storage.from(d.bucket!).createSignedUrl(d.path!, 3600);
    if (s?.signedUrl) links.set(d.id, s.signedUrl);
  }));
  const has = (kind: string) => b.documents.some((d) => d.kind === kind && d.path && !d.expired);

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 760 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my/settings">← Account setup</Link></p>
      <span className="kicker">Business</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 12px" }}>{co?.company_name ?? "Your business"}</h1>
      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {/* Sales and growth: the funnel, off your own bids. */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Sales &amp; growth</h2>
          {f.total === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>
              No bids yet. Once owners invite you, this counts what came in, what you answered and what you won.
            </p>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
              {[["Invited", f.invited], ["Awaiting decision", f.submitted], ["Won", f.won], ["Lost", f.lost]].map(([l, n]) => (
                <div key={String(l)} className="card" style={{ padding: "8px 10px", background: "#fafbfa" }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: "var(--brand)" }}>{n as number}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{l as string}</div>
                </div>
              ))}
              <div className="card" style={{ padding: "8px 10px", background: "#fafbfa" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--brand)" }}>{winRate == null ? "—" : `${winRate}%`}</div>
                <div className="muted" style={{ fontSize: 11 }}>Win rate</div>
              </div>
              <div className="card" style={{ padding: "8px 10px", background: "#fafbfa" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "var(--brand)" }}>{money(f.won_value)}</div>
                <div className="muted" style={{ fontSize: 11 }}>Won, total</div>
              </div>
            </div>
          )}
          <p className="muted small" style={{ margin: 0 }}>
            Average bid {money(f.avg_bid)} · trades you list: {b.trades.length > 0 ? b.trades.join(", ") : <Link href="/my/profile#trades">none yet — add them</Link>}
          </p>
        </div>

        {/* The company itself. */}
        <form action={saveCompany} className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Company</h2>
            <button className="btn small">Save</button>
          </div>
          {!co && <p className="muted small" style={{ margin: 0 }}>No company yet. Name it and it becomes yours to edit.</p>}
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-name">Company name</label>
              <input id="co-name" name="company_name" className="input" required defaultValue={co?.company_name ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-legal">Legal name</label>
              <input id="co-legal" name="legal_name" className="input" defaultValue={co?.legal_name ?? ""} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="co-address">Company address</label>
            <input id="co-address" name="address" className="input" defaultValue={co?.address ?? ""} />
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-phone">Phone</label>
              <input id="co-phone" name="main_phone" className="input" type="tel" defaultValue={co?.main_phone ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-email">Email</label>
              <input id="co-email" name="main_email" className="input" type="email" defaultValue={co?.main_email ?? ""} />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-web">Web page</label>
              <input id="co-web" name="website" className="input" defaultValue={co?.website ?? ""} placeholder="https://" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-lic">Licence number</label>
              <input id="co-lic" name="license_number" className="input" defaultValue={co?.license_number ?? ""} />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-zip">Service area (zip)</label>
              <input id="co-zip" name="service_zip" className="input" defaultValue={co?.service_zip ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="co-rad">How far you travel (miles)</label>
              <input id="co-rad" name="service_radius_miles" className="input" inputMode="numeric"
                defaultValue={co?.service_radius_miles ?? ""} />
            </div>
          </div>
          <label className="small" style={{ display: "inline-flex", gap: 6, alignItems: "center", margin: 0 }}>
            <input type="hidden" name="serves_adjacent_states__present" value="1" />
            <input type="checkbox" name="serves_adjacent_states" defaultChecked={!!co?.serves_adjacent_states} />
            I work in neighbouring states too
          </label>
        </form>

        {/* Automatic bids and the price list they are drafted from. */}
        <div id="prices" className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Price list · {b.prices.length}</h2>
            <Link href={add === "1" ? "/my/business#prices" : "/my/business?add=1#prices"} className="btn ghost small">
              {add === "1" ? "Close" : "＋ Add a line"}
            </Link>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            What you charge, line by line. Private to you: a proposal is drafted from it, an owner never reads the book itself.
          </p>

          {b.prices.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table className="tasktable">
                <thead><tr><th>Trade</th><th>Line</th><th>Unit</th><th style={{ textAlign: "right" }}>Price</th><th /></tr></thead>
                <tbody>
                  {b.prices.map((it) => (
                    <tr key={it.id} style={{ opacity: it.is_active ? 1 : 0.55 }}>
                      <td className="muted small">{it.trade ?? "—"}</td>
                      <td className="small"><strong>{it.item}</strong>{it.notes && <div className="muted" style={{ fontSize: 11 }}>{it.notes}</div>}</td>
                      <td className="muted small">{it.unit}</td>
                      <td className="small" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(it.unit_price)}</td>
                      <td style={{ textAlign: "right" }}>
                        <form action={deletePriceItem.bind(null, it.id)}>
                          <button className="btn ghost small" style={{ padding: "1px 8px", color: "#c0262d" }} aria-label={`Remove ${it.item}`}>✕</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {add === "1" && (
            <form action={savePriceItem} style={{ display: "grid", gap: 8, borderTop: "1px solid #eef0ec", paddingTop: 10 }}>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pi-item">What you charge for</label>
                  <input id="pi-item" name="item" className="input" required placeholder="Recessed light, supply and install" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pi-trade">Trade</label>
                  <select id="pi-trade" name="trade" className="input" defaultValue={b.trades[0] ?? ""}>
                    <option value="">Not trade-specific</option>
                    {b.all_trades.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pi-unit">Unit</label>
                  <input id="pi-unit" name="unit" className="input" defaultValue="each" placeholder="each, hour, sq ft, day" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="pi-price">Price</label>
                  <input id="pi-price" name="unit_price" className="input" inputMode="decimal" placeholder="185" />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="pi-notes">What it includes</label>
                <input id="pi-notes" name="notes" className="input" placeholder="Fixture, box, wire, trim. Owner supplies the fitting." />
              </div>
              <div className="btn-row"><button className="btn small">Save line</button></div>
            </form>
          )}
        </div>

        {/* Terms: how you bid, how you get paid, what you warrant. */}
        <form action={saveTerms} id="terms" className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Automatic bids &amp; financial setup</h2>
            <button className="btn small">Save</button>
          </div>
          <label className="small" style={{ display: "flex", gap: 8, alignItems: "flex-start", margin: 0 }}>
            <input type="checkbox" name="auto_bid" defaultChecked={!!st?.auto_bid} style={{ marginTop: 3 }} />
            <span>
              <strong>Draft my proposals automatically</strong>
              <div className="muted" style={{ fontSize: 11 }}>
                When an owner invites you, the scope lines are priced from your list and a draft proposal waits for you. It is never sent until you send it.
              </div>
            </span>
          </label>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tm-note">Standard note on a proposal</label>
            <input id="tm-note" name="auto_bid_note" className="input" defaultValue={st?.auto_bid_note ?? ""}
              placeholder="Price holds 30 days. Permit fees not included." />
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="tm-net">Payment terms (net days)</label>
              <input id="tm-net" name="net_days" className="input" inputMode="numeric" defaultValue={st?.net_days ?? ""} placeholder="30" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="tm-dep">Deposit you ask for (%)</label>
              <input id="tm-dep" name="deposit_pct" className="input" inputMode="decimal" defaultValue={st?.deposit_pct ?? ""} placeholder="30" />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="tm-ret">Retainage you accept (%)</label>
              <input id="tm-ret" name="retainage_pct" className="input" inputMode="decimal" defaultValue={st?.retainage_pct ?? ""} placeholder="10" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="tm-inv">Where invoices go</label>
              <input id="tm-inv" name="invoice_email" className="input" type="email" defaultValue={st?.invoice_email ?? ""} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tm-pay">How you prefer to be paid</label>
            <input id="tm-pay" name="preferred_payment" className="input" defaultValue={st?.preferred_payment ?? ""}
              placeholder="Check, or ACH on request" />
            <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>
              Describe it in words. Account and routing numbers are never collected here — you give those to the owner directly.
            </p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="tm-war">Warranty you offer</label>
            <textarea id="tm-war" name="warranty_terms" className="input" rows={2} defaultValue={st?.warranty_terms ?? ""}
              placeholder="One year on labour, manufacturer's warranty on parts." />
          </div>
        </form>

        {/* The paperwork an owner asks for. */}
        <div id="papers" className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>W9, insurance &amp; warranties · {b.documents.length}</h2>
            <Link href={doc === "1" ? "/my/business#papers" : "/my/business?doc=1#papers"} className="btn ghost small">
              {doc === "1" ? "Close" : "＋ Add a document"}
            </Link>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {DOC_KINDS.slice(0, 3).map(([k, label]) => (
              <span key={k} className="extra-chip"
                style={has(k) ? { background: "#e6f2ea", color: "#1f6b45" } : { background: "#fdf4e3", color: "#a8842c" }}>
                {has(k) ? "✓" : "○"} {label}
              </span>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Only you, the people on your projects, and an owner reading your bid can open these.
          </p>

          {b.documents.map((d) => (
            <div key={d.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", borderTop: "1px solid #eef0ec", paddingTop: 6, flexWrap: "wrap" }}>
              <span style={{ minWidth: 0 }}>
                <strong>{d.label}</strong>
                <span className="muted"> · {DOC_KINDS.find(([k]) => k === d.kind)?.[1] ?? d.kind}</span>
                {d.expires_on && <span className="muted"> · expires {d.expires_on}</span>}
              </span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                {d.expired && <span className="extra-chip" style={{ background: "#fdecec", color: "#c0262d" }}>expired</span>}
                {links.get(d.id) && <a href={links.get(d.id)} target="_blank" rel="noreferrer" className="btn ghost small" style={{ padding: "1px 8px" }}>Open</a>}
                <form action={deleteCredential.bind(null, d.id)}>
                  <button className="btn ghost small" style={{ padding: "1px 8px", color: "#c0262d" }} aria-label={`Remove ${d.label}`}>✕</button>
                </form>
              </span>
            </div>
          ))}
          {b.documents.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing on file yet.</p>}

          {doc === "1" && (
            <form action={saveBusinessDoc} style={{ display: "grid", gap: 8, borderTop: "1px solid #eef0ec", paddingTop: 10 }}>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="d-kind">Kind</label>
                  <select id="d-kind" name="kind" className="input" defaultValue="w9">
                    {DOC_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="d-label">Name it</label>
                  <input id="d-label" name="label" className="input" required placeholder="W9 2026" />
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="d-issuer">Issued by</label>
                  <input id="d-issuer" name="issuer" className="input" placeholder="Carrier or agency" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="d-exp">Expires</label>
                  <input id="d-exp" name="expires_on" className="input" type="date" />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="d-file">The document (PDF or photo)</label>
                <input id="d-file" name="file" className="input" type="file" accept="image/*,application/pdf" />
              </div>
              <div className="btn-row"><button className="btn small">Save document</button></div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
