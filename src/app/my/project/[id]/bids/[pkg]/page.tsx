import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FileDrop } from "@/components/FileDrop";
import { savePackage, setPackageItems, inviteBidders, attachBidDocs } from "../actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Item = { id: string; scope_item_id: string; item: string; category: string | null; is_required: boolean; sort: number };
type Candidate = { id: string; item: string; category: string | null };
type Doc = { id: string; file_name: string; kind: string | null; bucket: string; path: string };
type Bid = { id: string; bidder: string | null; bidder_contact_id: string; status: string; amount: number | null; received_on: string | null; valid_until: string | null; is_like_for_like: boolean | null; scope_gaps: string | null };
type Member = { contact_id: string; name: string; trade: string | null };
type Pkg = {
  id: string; project_id: string; project_name: string | null; phase: string | null; category: string | null; trade: string | null;
  scope_summary: string | null; budget_amount: number | null; budget_visible: boolean;
  deposit_pct: number | null; retainage_pct: number | null; retainage_release_trigger: string | null; net_days: number | null;
  consumables_by: string | null; finish_material_by: string | null;
  insurance_gl_per_occurrence: number | null; insurance_gl_aggregate: number | null; insurance_workers_comp: boolean | null; coi_required: boolean | null;
  reply_by: string | null; status: string; awarded_bid_id: string | null; can_edit: boolean;
  items: Item[]; candidates: Candidate[]; docs: Doc[]; bids: Bid[]; members: Member[];
};

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const chip = (s: string) => ({
  background: s === "open" || s === "awarded" || s === "received" ? "#e4f0e9" : s === "reviewing" || s === "under negotiation" ? "#f7efdd" : "#eef1ea",
  color: s === "open" || s === "awarded" || s === "received" ? "#2f6b4f" : s === "reviewing" || s === "under negotiation" ? "#a8842c" : "#7b857e",
});

// One bid package: scope, documents, budget, terms, insurance, invitations,
// replies. Everything a bidder needs lives here and nowhere else.
export default async function BidPackagePage({
  params, searchParams,
}: {
  params: Promise<{ id: string; pkg: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id, pkg: pkgId } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_bid_package", { p_pkg: pkgId });
  const p = (data ?? null) as Pkg | null;
  if (!p || p.project_id !== id) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">This package is not yours to see.</p></main>;
  }
  const docUrls = new Map<string, string>();
  await Promise.all(p.docs.map(async (d) => {
    const { data: s } = await supabase.storage.from(d.bucket).createSignedUrl(d.path, 3600);
    if (s?.signedUrl) docUrls.set(d.id, s.signedUrl);
  }));
  const back = `/my/project/${id}/bids/${pkgId}`;
  const save = savePackage.bind(null, id, pkgId);
  const editable = p.can_edit && p.status !== "closed";

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 760 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href={`/my/project/${id}/bids`}>← Bid planner · {p.project_name}</Link></p>
      <span className="kicker">Bid package · {p.phase ?? "—"}</span>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, margin: "6px 0 2px" }}>{p.category ?? p.trade ?? "Package"}</h1>
        <span className="extra-chip" style={chip(p.status)}>{p.status}</span>
      </div>
      <p className="muted small" style={{ margin: "0 0 12px" }}>
        {p.trade && p.trade !== p.category ? `Trade: ${p.trade} · ` : ""}Reply by {p.reply_by ?? "—"} · {p.bids.length} invited · {p.bids.filter((b) => b.status !== "invited" && b.status !== "no response").length} replied
      </p>
      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {/* Stage controls */}
        {p.can_edit && (
          <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="small muted">Stage:</span>
            {p.status === "draft" && (
              <form action={save}><input type="hidden" name="status" value="open" /><button className="btn small">Publish — open for replies</button></form>
            )}
            {p.status === "open" && (
              <form action={save}><input type="hidden" name="status" value="reviewing" /><button className="btn small">Move to reviewing</button></form>
            )}
            {(p.status === "reviewing" || p.status === "closed") && (
              <form action={save}><input type="hidden" name="status" value="open" /><button className="btn ghost small">Reopen for replies</button></form>
            )}
            {p.status !== "closed" && p.status !== "draft" && (
              <form action={save}><input type="hidden" name="status" value="closed" /><button className="btn ghost small">Close package</button></form>
            )}
          </div>
        )}

        {/* Scope */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Scope · {p.items.length} line{p.items.length === 1 ? "" : "s"} · {p.items.filter((i) => i.is_required).length} required</h2>
          {p.scope_summary && <p className="small" style={{ margin: 0 }}>{p.scope_summary}</p>}
          {!editable && p.items.map((i) => (
            <div key={i.id} className="small" style={{ display: "flex", gap: 8, borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
              <span style={{ flex: 1 }}>{i.item}</span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>{i.is_required ? "required" : "optional"}</span>
            </div>
          ))}
          {editable && (
            <form action={setPackageItems.bind(null, id, pkgId)} style={{ display: "grid", gap: 6 }}>
              <div className="muted" style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                <span>In</span><span>Line</span><span>Required</span>
              </div>
              {p.items.map((i) => (
                <label key={i.id} className="small" style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px", gap: 8, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                  <input type="checkbox" name="item" value={i.scope_item_id} defaultChecked />
                  <span>{i.item}</span>
                  <span><input type="checkbox" name="req" value={i.scope_item_id} defaultChecked={i.is_required} /></span>
                </label>
              ))}
              {p.candidates.length > 0 && (
                <>
                  <span className="muted small" style={{ marginTop: 6 }}>Not in this package yet ({p.trade ?? "this trade"}):</span>
                  {p.candidates.map((c) => (
                    <label key={c.id} className="small" style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px", gap: 8, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                      <input type="checkbox" name="item" value={c.id} />
                      <span className="muted">{c.item}</span>
                      <span><input type="checkbox" name="req" value={c.id} defaultChecked /></span>
                    </label>
                  ))}
                </>
              )}
              {p.items.length === 0 && p.candidates.length === 0 && (
                <p className="muted small" style={{ margin: 0 }}>No scope lines for this trade yet — add scope items on the project first, or set the trade below.</p>
              )}
              <div><button className="btn small">Save scope</button></div>
            </form>
          )}
        </div>

        {/* Documents */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Documents · {p.docs.length}</h2>
          {p.docs.length === 0 && <p className="muted small" style={{ margin: 0 }}>Plans, specs and photos bidders should price from.</p>}
          {p.docs.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {p.docs.map((d) => {
                const u = docUrls.get(d.id);
                return u
                  ? <a key={d.id} href={u} target="_blank" rel="noreferrer" className="extra-chip" style={{ textDecoration: "none" }}>{d.kind === "photo" ? "🖼" : "📄"} {d.file_name}</a>
                  : <span key={d.id} className="extra-chip">{d.file_name}</span>;
              })}
            </div>
          )}
          {editable && (
            <form action={attachBidDocs.bind(null, id, pkgId, null, back)} style={{ display: "grid", gap: 6 }}>
              <FileDrop name="photos" accept="image/*,application/pdf" label="Add plans / photos" />
              <div><button className="btn ghost small">Upload</button></div>
            </form>
          )}
        </div>

        {/* Details, budget, terms, insurance */}
        <form action={save} className="card" style={{ display: "grid", gap: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Budget, terms &amp; insurance</h2>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-trade">Trade</label>
              <input id="bp-trade" name="trade" className="input" defaultValue={p.trade ?? ""} readOnly={!editable} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-reply">Reply by</label>
              <input id="bp-reply" name="reply_by" type="date" className="input" defaultValue={p.reply_by ?? ""} readOnly={!editable} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="bp-sum">Scope summary (what bidders read first)</label>
            <textarea id="bp-sum" name="scope_summary" className="input" rows={2} defaultValue={p.scope_summary ?? ""} readOnly={!editable} />
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Budget (from the budget line)</label>
              <div className="input" style={{ background: "#fafbfa" }}>{money(p.budget_amount)}</div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Visibility</label>
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", height: 40 }}>
                <input type="hidden" name="budget_visible" value="0" />
                <input type="checkbox" name="budget_visible" value="1" defaultChecked={p.budget_visible} disabled={!editable} />
                <span>Show the target to bidders</span>
              </label>
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-dep">Deposit %</label>
              <input id="bp-dep" name="deposit_pct" className="input" inputMode="decimal" defaultValue={p.deposit_pct ?? ""} readOnly={!editable} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-ret">Retainage %</label>
              <input id="bp-ret" name="retainage_pct" className="input" inputMode="decimal" defaultValue={p.retainage_pct ?? ""} readOnly={!editable} />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-rel">Retainage released on</label>
              <input id="bp-rel" name="retainage_release_trigger" className="input" defaultValue={p.retainage_release_trigger ?? ""} placeholder="e.g. final inspection" readOnly={!editable} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-net">Net days</label>
              <input id="bp-net" name="net_days" className="input" inputMode="numeric" defaultValue={p.net_days ?? ""} readOnly={!editable} />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-cons">Consumables by</label>
              <input id="bp-cons" name="consumables_by" className="input" defaultValue={p.consumables_by ?? ""} placeholder="trade / owner" readOnly={!editable} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-fin">Finish materials by</label>
              <input id="bp-fin" name="finish_material_by" className="input" defaultValue={p.finish_material_by ?? ""} placeholder="trade / owner" readOnly={!editable} />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-glo">GL per occurrence ($)</label>
              <input id="bp-glo" name="gl_occ" className="input" inputMode="decimal" defaultValue={p.insurance_gl_per_occurrence ?? ""} placeholder="1,000,000" readOnly={!editable} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="bp-gla">GL aggregate ($)</label>
              <input id="bp-gla" name="gl_agg" className="input" inputMode="decimal" defaultValue={p.insurance_gl_aggregate ?? ""} placeholder="2,000,000" readOnly={!editable} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="hidden" name="wc" value="0" />
              <input type="checkbox" name="wc" value="1" defaultChecked={!!p.insurance_workers_comp} disabled={!editable} /> Workers&apos; comp required
            </label>
            <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="hidden" name="coi" value="0" />
              <input type="checkbox" name="coi" value="1" defaultChecked={!!p.coi_required} disabled={!editable} /> COI naming you as additional insured
            </label>
          </div>
          {editable && <div><button className="btn">Save package</button></div>}
        </form>

        {/* Invite */}
        {editable && (p.status === "draft" || p.status === "open") && (
          <details className="card" open={p.bids.length === 0 && p.status === "open"}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>Invite bidders</summary>
            <form action={inviteBidders.bind(null, id, pkgId)} style={{ display: "grid", gap: 6, marginTop: 10 }}>
              <p className="muted small" style={{ margin: 0 }}>People on this project, by trade. Anyone you want to invite must be on the project first (Settings → Contacts / Invite).</p>
              {p.members.filter((m) => !p.bids.some((b) => b.bidder_contact_id === m.contact_id)).map((m) => (
                <label key={m.contact_id} className="small" style={{ display: "flex", gap: 8, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                  <input type="checkbox" name="contact" value={m.contact_id} defaultChecked={!!p.trade && !!m.trade && m.trade.toLowerCase() === p.trade.toLowerCase()} />
                  <span style={{ flex: 1 }}>{m.name}</span>
                  <span className="muted">{m.trade ?? "—"}</span>
                </label>
              ))}
              <div><button className="btn small">Invite selected</button></div>
            </form>
          </details>
        )}

        {/* Replies */}
        <div className="card" style={{ display: "grid", gap: 8, overflowX: "auto" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Replies · {p.bids.length}</h2>
          {p.bids.length === 0 && <p className="muted small" style={{ margin: 0 }}>No one invited yet.</p>}
          {p.bids.length > 0 && (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead><tr><th>Bidder</th><th>Status</th><th style={{ textAlign: "right" }}>Amount</th><th>Like for like</th><th>Received</th><th aria-label="Open" /></tr></thead>
              <tbody>
                {p.bids.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 600 }}>{b.bidder ?? "—"}</td>
                    <td><span className="extra-chip" style={chip(b.status)}>{b.status}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(b.amount)}</td>
                    <td className="small">{b.is_like_for_like == null ? <span className="muted">—</span> : b.is_like_for_like ? <span style={{ color: "#2f6b4f", fontWeight: 600 }}>yes</span> : <span style={{ color: "#c0262d", fontWeight: 600 }} title={b.scope_gaps ?? ""}>gaps</span>}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{b.received_on ?? "—"}</td>
                    <td style={{ textAlign: "right" }}><Link href={`/my/bid/${b.id}`} className="small">View →</Link></td>
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
