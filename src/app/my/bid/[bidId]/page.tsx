import Link from "next/link";
import { ProjectBrief } from "@/components/ProjectBrief";
import { createClient } from "@/lib/supabase/server";
import { FileDrop } from "@/components/FileDrop";
import { submitReply, attachBidDocs } from "../../project/[id]/bids/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Doc = { id: string; file_name: string; kind: string | null; bucket: string; path: string };
type PkgItem = { scope_item_id: string; item: string; is_required: boolean };
type LineItem = { scope_item_id: string; included: boolean; price: number | null };
type Bid = {
  id: string; status: string; amount: number | null; valid_until: string | null; notes: string | null; received_on: string | null;
  line_items: LineItem[] | null;
  terms_reply: { deposit_pct?: number | null; retainage_pct?: number | null; net_days?: number | null; note?: string | null } | null;
  insurance_reply: { gl_held?: boolean; wc_held?: boolean; coi?: boolean; carrier?: string | null } | null;
  bidder: string | null; can_reply: boolean; can_manage: boolean;
  package: {
    id: string; project_id: string; project_name: string | null;
    // The home the job hangs under: what tells two jobs of the same name
    // apart for a bidder who prices work on five sites.
    project_parent_id: string | null; project_parent_name: string | null;
    phase: string | null; category: string | null; trade: string | null;
    scope_summary: string | null; reply_by: string | null; status: string; budget_amount: number | null;
    deposit_pct: number | null; retainage_pct: number | null; retainage_release_trigger: string | null; net_days: number | null;
    consumables_by: string | null; finish_material_by: string | null;
    insurance_gl_per_occurrence: number | null; insurance_gl_aggregate: number | null; insurance_workers_comp: boolean | null; coi_required: boolean | null;
    items: PkgItem[]; docs: Doc[];
  };
  docs: Doc[];
};

const money = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);

// A bidder's reply to one package, in the package's own shape: every scope
// line answered, terms accepted or countered, insurance stated, one total.
export default async function BidReplyPage({
  params, searchParams,
}: {
  params: Promise<{ bidId: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { bidId } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_bid", { p_bid: bidId });
  const b = (data ?? null) as Bid | null;
  if (!b) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">This bid is not yours to see.</p><p><Link href="/my">← Home</Link></p></main>;
  }
  const pk = b.package;
  const sign = async (docs: Doc[]) => {
    const m = new Map<string, string>();
    await Promise.all(docs.map(async (d) => {
      const { data: s } = await supabase.storage.from(d.bucket).createSignedUrl(d.path, 3600);
      if (s?.signedUrl) m.set(d.id, s.signedUrl);
    }));
    return m;
  };
  const [pkgUrls, replyUrls] = await Promise.all([sign(pk.docs), sign(b.docs)]);
  const back = `/my/bid/${bidId}`;
  const prior = new Map((b.line_items ?? []).map((li) => [li.scope_item_id, li]));
  const docList = (docs: Doc[], urls: Map<string, string>) => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {docs.map((d) => {
        const u = urls.get(d.id);
        return u
          ? <a key={d.id} href={u} target="_blank" rel="noreferrer" className="extra-chip" style={{ textDecoration: "none" }}>{d.kind === "photo" ? "🖼" : "📄"} {d.file_name}</a>
          : <span key={d.id} className="extra-chip">{d.file_name}</span>;
      })}
    </div>
  );

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 760 }}>
      <p className="small" style={{ margin: "0 0 6px" }}>
        <Link href={b.can_manage ? `/my/project/${pk.project_id}/bids/${pk.id}` : `/my/project/${pk.project_id}`}>← {pk.project_name ?? "Project"}</Link>
      </p>
      <span className="kicker">Bid reply · {pk.phase ?? "—"}</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 2px" }}>{pk.category ?? pk.trade ?? "Package"}</h1>
      <p className="muted small" style={{ margin: "0 0 2px" }}>
        {pk.project_parent_name && <>{pk.project_parent_name} <span aria-hidden>›</span> </>}
        <strong style={{ color: "var(--ink)" }}>{pk.project_name ?? "Project"}</strong>
      </p>
      <p className="muted small" style={{ margin: "0 0 12px" }}>
        {b.bidder ? `${b.bidder} · ` : ""}status <strong>{b.status}</strong> · reply by {pk.reply_by ?? "—"}
        {pk.status !== "open" && <> · <span style={{ color: "#a8842c" }}>package {pk.status}</span></>}
      </p>
      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {/* The package, as the bidder sees it */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>What is being priced</h2>
          {pk.scope_summary && <p className="small" style={{ margin: 0 }}>{pk.scope_summary}</p>}
          <div className="small muted" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
            {pk.budget_amount != null && <span>Target: <strong>{money(pk.budget_amount)}</strong></span>}
            <span>Deposit <strong>{pk.deposit_pct ?? "—"}%</strong></span>
            <span>Retainage <strong>{pk.retainage_pct ?? "—"}%</strong>{pk.retainage_release_trigger ? ` on ${pk.retainage_release_trigger}` : ""}</span>
            <span>Net <strong>{pk.net_days ?? "—"}</strong></span>
            <span>Consumables: <strong>{pk.consumables_by ?? "—"}</strong></span>
            <span>Finish materials: <strong>{pk.finish_material_by ?? "—"}</strong></span>
          </div>
          <div className="small muted">
            Insurance: GL {money(pk.insurance_gl_per_occurrence)} / {money(pk.insurance_gl_aggregate)}
            {pk.insurance_workers_comp ? " · workers' comp" : ""}{pk.coi_required ? " · COI as additional insured" : ""}
          </div>
          {pk.docs.length > 0 && docList(pk.docs, pkgUrls)}
        </div>

        {/* The owner's brief: their description, the specs, their photos. */}
        <ProjectBrief projectId={pk.project_id} title="Owner's brief" />

        {b.can_reply ? (
          <form action={submitReply.bind(null, bidId)} className="card" style={{ display: "grid", gap: 10 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Your reply</h2>
            <input type="hidden" name="items" value={pk.items.map((i) => i.scope_item_id).join(",")} />
            <div className="muted" style={{ display: "grid", gridTemplateColumns: "24px 1fr 120px", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
              <span>In</span><span>Scope line</span><span>Price ($)</span>
            </div>
            {pk.items.map((i) => {
              const li = prior.get(i.scope_item_id);
              return (
                <div key={i.scope_item_id} className="small" style={{ display: "grid", gridTemplateColumns: "24px 1fr 120px", gap: 8, alignItems: "center", borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                  <input type="checkbox" name={`inc_${i.scope_item_id}`} defaultChecked={li ? li.included : true} />
                  <span>{i.item}{i.is_required && <span className="muted"> · required</span>}</span>
                  <input name={`price_${i.scope_item_id}`} className="input" inputMode="decimal" defaultValue={li?.price ?? ""} placeholder="incl." style={{ height: 32, padding: "2px 8px" }} />
                </div>
              );
            })}
            <h3 style={{ fontSize: 15, margin: "6px 0 0" }}>Terms — leave blank to accept, or counter</h3>
            <div className="form-2col">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="r-dep">Deposit % (asked: {pk.deposit_pct ?? "—"})</label>
                <input id="r-dep" name="r_deposit" className="input" inputMode="decimal" defaultValue={b.terms_reply?.deposit_pct ?? ""} placeholder="accept" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="r-ret">Retainage % (asked: {pk.retainage_pct ?? "—"})</label>
                <input id="r-ret" name="r_retainage" className="input" inputMode="decimal" defaultValue={b.terms_reply?.retainage_pct ?? ""} placeholder="accept" />
              </div>
            </div>
            <div className="form-2col">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="r-net">Net days (asked: {pk.net_days ?? "—"})</label>
                <input id="r-net" name="r_net" className="input" inputMode="numeric" defaultValue={b.terms_reply?.net_days ?? ""} placeholder="accept" />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="r-tn">Terms note</label>
                <input id="r-tn" name="r_terms_note" className="input" defaultValue={b.terms_reply?.note ?? ""} />
              </div>
            </div>
            <h3 style={{ fontSize: 15, margin: "6px 0 0" }}>Insurance you hold</h3>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="ins_gl" defaultChecked={!!b.insurance_reply?.gl_held} /> General liability at the asked limits</label>
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="ins_wc" defaultChecked={!!b.insurance_reply?.wc_held} /> Workers&apos; comp</label>
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" name="ins_coi" defaultChecked={!!b.insurance_reply?.coi} /> Can issue a COI</label>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="r-car">Carrier</label>
              <input id="r-car" name="ins_carrier" className="input" defaultValue={b.insurance_reply?.carrier ?? ""} />
            </div>
            <div className="form-2col">
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="r-amt">Total ($)</label>
                <input id="r-amt" name="amount" className="input" inputMode="decimal" required defaultValue={b.amount ?? ""} />
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="r-val">Valid until</label>
                <input id="r-val" name="valid_until" type="date" className="input" defaultValue={b.valid_until ?? ""} />
              </div>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="r-notes">Notes</label>
              <textarea id="r-notes" name="notes" className="input" rows={3} defaultValue={b.notes ?? ""} />
            </div>
            <div><button className="btn">{b.status === "invited" ? "Submit reply" : "Update reply"}</button></div>
          </form>
        ) : (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <h2 className="section-title" style={{ margin: 0 }}>Reply{b.received_on ? ` · received ${b.received_on}` : ""}</h2>
            {!b.line_items && <p className="muted small" style={{ margin: 0 }}>No reply submitted yet.</p>}
            {b.line_items && (
              <>
                {pk.items.map((i) => {
                  const li = prior.get(i.scope_item_id);
                  return (
                    <div key={i.scope_item_id} className="small" style={{ display: "flex", gap: 8, borderTop: "1px solid #f0f1ee", paddingTop: 6 }}>
                      <span style={{ flex: 1 }}>{i.item}{i.is_required && <span className="muted"> · required</span>}</span>
                      <span style={{ whiteSpace: "nowrap", color: li?.included ? "#2f6b4f" : "#c0262d", fontWeight: 600 }}>{li?.included ? (li.price != null ? money(li.price) : "included") : "excluded"}</span>
                    </div>
                  );
                })}
                <div className="small muted" style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 4 }}>
                  <span>Deposit: <strong>{b.terms_reply?.deposit_pct ?? "accept"}</strong></span>
                  <span>Retainage: <strong>{b.terms_reply?.retainage_pct ?? "accept"}</strong></span>
                  <span>Net: <strong>{b.terms_reply?.net_days ?? "accept"}</strong></span>
                  <span>GL <strong>{b.insurance_reply?.gl_held ? "held" : "no"}</strong> · WC <strong>{b.insurance_reply?.wc_held ? "held" : "no"}</strong> · COI <strong>{b.insurance_reply?.coi ? "yes" : "no"}</strong></span>
                </div>
                <div className="small"><span className="muted">Total: </span><strong>{money(b.amount)}</strong>{b.valid_until ? <span className="muted"> · valid until {b.valid_until}</span> : null}</div>
                {b.notes && <div className="small" style={{ whiteSpace: "pre-line" }}><span className="muted">Notes: </span>{b.notes}</div>}
              </>
            )}
          </div>
        )}

        {/* Reply documents */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your documents · {b.docs.length}</h2>
          {b.docs.length > 0 && docList(b.docs, replyUrls)}
          {(b.can_reply || b.can_manage) && (
            <form action={attachBidDocs.bind(null, pk.project_id, pk.id, bidId, back)} style={{ display: "grid", gap: 6 }}>
              <FileDrop name="photos" accept="image/*,application/pdf" label="Add quote / COI / photos" />
              <div><button className="btn ghost small">Upload</button></div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
