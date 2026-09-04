import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PhotoPick } from "@/components/PhotoPick";
import { saveProfile } from "../settings/actions";
import { saveFullProfile, saveMyTrades, saveCredential, deleteCredential } from "./actions";

export const dynamic = "force-dynamic";

type TradeRole = { trade: string; service_scope: string | null; notes: string | null; license_label: string | null };
type Credential = {
  id: string; trade: string | null; kind: string; label: string; number: string | null;
  issuer: string | null; issued_on: string | null; expires_on: string | null;
  file_name: string | null; bucket: string | null; path: string | null;
  status: string; expired: boolean;
};
type AllTrade = { trade: string; stage: string | null; license_label: string | null };
type Profile = {
  app_user_id: string; full_name: string | null; email: string | null; contact_id: string | null;
  contact: {
    person_name: string | null; name: string | null; title: string | null;
    phone: string | null; phone_type: string | null; phone_2: string | null; phone_2_type: string | null;
    email_a: string | null; email_b: string | null; address: string | null; notes: string | null;
    referral: string | null; role_at_company: string | null; company_name: string | null;
    vendor_status: string | null; avatar_path: string | null;
  } | null;
  trades: TradeRole[]; credentials: Credential[]; all_trades: AllTrade[];
};

const PHONE_TYPES = ["mobile", "office", "home", "fax", "other"];
const KINDS = [["license", "Licence"], ["certification", "Certification"], ["insurance", "Insurance"], ["bond", "Bond"], ["other", "Other"]];

// Everything you can tell the platform about yourself, on one page. The
// account panel on Settings keeps the few fields you change often; this is
// where the rest lives, including the papers that back a licensed trade.
export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; add?: string }>;
}) {
  const { ok, error, add } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_my_profile");
  const p = (data ?? null) as Profile | null;
  if (!p) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">Sign in to edit your profile.</p></main>;
  }
  const c = p.contact;
  const mine = new Set(p.trades.map((t) => t.trade));
  // Licensed trades you claim but have no paper for — the gap worth closing.
  const missing = p.trades.filter((t) => t.license_label
    && !p.credentials.some((k) => k.trade === t.trade && k.path));
  // Signed links for the documents, an hour each.
  const links = new Map<string, string>();
  await Promise.all(p.credentials.filter((k) => k.bucket && k.path).map(async (k) => {
    const { data: s } = await supabase.storage.from(k.bucket!).createSignedUrl(k.path!, 3600);
    if (s?.signedUrl) links.set(k.id, s.signedUrl);
  }));
  const byStage = new Map<string, AllTrade[]>();
  for (const t of p.all_trades) {
    const key = t.stage ?? "Other";
    byStage.set(key, [...(byStage.get(key) ?? []), t]);
  }

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 720 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my/settings">← Account setup</Link></p>
      <span className="kicker">Profile</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 12px" }}>Your full details</h1>
      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {missing.length > 0 && (
          <p className="small" style={{ margin: 0, padding: "8px 10px", borderRadius: 8, background: "#fdf4e3", color: "#8a6d1f" }}>
            {missing.map((m) => m.trade).join(", ")}: adding the licence you already hold is what turns a stranger into a known contractor. Owners see that it is on file.
          </p>
        )}

        {/* Who you are. */}
        <form action={saveFullProfile} className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>About you</h2>
            <button className="btn small">Save</button>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-full">Full name</label>
              <input id="pf-full" name="full_name" className="input" defaultValue={p.full_name ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-title">Title</label>
              <input id="pf-title" name="title" className="input" defaultValue={c?.title ?? ""} placeholder="Master electrician" />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-company">Company</label>
              <input id="pf-company" className="input" defaultValue={c?.company_name ?? ""} disabled
                placeholder="Set by the office" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-role">Your role there</label>
              <input id="pf-role" name="role_at_company" className="input" defaultValue={c?.role_at_company ?? ""} placeholder="Owner" />
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-phone">Phone</label>
              <input id="pf-phone" name="phone" className="input" type="tel" defaultValue={c?.phone ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-phonet">Phone type</label>
              <select id="pf-phonet" name="phone_type" className="input" defaultValue={c?.phone_type ?? "mobile"}>
                {PHONE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-phone2">Second phone</label>
              <input id="pf-phone2" name="phone_2" className="input" type="tel" defaultValue={c?.phone_2 ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-phone2t">Second phone type</label>
              <select id="pf-phone2t" name="phone_2_type" className="input" defaultValue={c?.phone_2_type ?? "office"}>
                {PHONE_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-email">Sign-in email</label>
              <input id="pf-email" className="input" defaultValue={p.email ?? ""} disabled />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-email2">Other email</label>
              <input id="pf-email2" name="email_b" className="input" type="email" defaultValue={c?.email_b ?? ""} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="pf-address">Office address</label>
            <input id="pf-address" name="address" className="input" defaultValue={c?.address ?? ""} />
          </div>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="pf-ref">Who referred you</label>
              <input id="pf-ref" name="referral" className="input" defaultValue={c?.referral ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Vendor status</label>
              <input className="input" defaultValue={c?.vendor_status ?? "—"} disabled />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="pf-notes">About your work</label>
            <textarea id="pf-notes" name="notes" className="input" rows={3} defaultValue={c?.notes ?? ""}
              placeholder="What you do, the jobs you take, anything an owner should know." />
          </div>
        </form>

        {/* The photo keeps its own small form: it posts a file. */}
        <form action={saveProfile} className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Photo</h2>
            <button className="btn small">Save photo</button>
          </div>
          <PhotoPick name="avatar" label="Add photo" />
          <p className="muted small" style={{ margin: 0 }}>
            Shows on task panels and site rosters. Leave empty to keep {c?.avatar_path ? "your current photo" : "the icon"}.
          </p>
        </form>

        {/* What you do. */}
        <form action={saveMyTrades} id="trades" className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Trades you provide · {p.trades.length}</h2>
            <button className="btn small">Save trades</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            A 🎓 marks a trade that carries a licence. Claim it here, then add the paper below.
          </p>
          {[...byStage.entries()].map(([stage, list]) => (
            <details key={stage} open={list.some((t) => mine.has(t.trade))}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>
                {stage} · {list.filter((t) => mine.has(t.trade)).length}/{list.length}
              </summary>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 4, marginTop: 6 }}>
                {list.map((t) => (
                  <label key={t.trade} className="small" style={{ display: "flex", gap: 6, alignItems: "center", margin: 0 }}>
                    <input type="checkbox" name="trade" value={t.trade} defaultChecked={mine.has(t.trade)} />
                    <span>{t.trade}</span>
                    {t.license_label && <span title={t.license_label}>🎓</span>}
                  </label>
                ))}
              </div>
            </details>
          ))}
        </form>

        {/* The papers. */}
        <div id="papers" className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Licences &amp; certifications · {p.credentials.length}</h2>
            <Link href={add === "1" ? "/my/profile#papers" : "/my/profile?add=1#papers"} className="btn ghost small">
              {add === "1" ? "Close" : "＋ Add a document"}
            </Link>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Only you, the people on your projects, and an owner reading your bid can open these. Nobody else.
          </p>

          {p.credentials.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing on file yet.</p>}
          {p.credentials.map((k) => (
            <div key={k.id} className="small" style={{ display: "grid", gap: 2, borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ minWidth: 0 }}>
                  <strong>{k.label}</strong>
                  {k.trade && <span className="muted"> · {k.trade}</span>}
                  {k.number && <span className="muted"> · #{k.number}</span>}
                </span>
                <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                  {k.expired
                    ? <span className="extra-chip" style={{ background: "#fdecec", color: "#c0262d" }}>expired</span>
                    : k.status === "verified"
                      ? <span className="extra-chip" style={{ background: "#e6f2ea", color: "#1f6b45" }}>verified</span>
                      : <span className="extra-chip">on file, not yet checked</span>}
                  {links.get(k.id) && <a href={links.get(k.id)} target="_blank" rel="noreferrer" className="btn ghost small" style={{ padding: "1px 8px" }}>Open</a>}
                  <form action={deleteCredential.bind(null, k.id)}>
                    <button className="btn ghost small" style={{ padding: "1px 8px", color: "#c0262d" }} aria-label={`Remove ${k.label}`}>✕</button>
                  </form>
                </span>
              </div>
              <span className="muted" style={{ fontSize: 11 }}>
                {k.issuer ? `${k.issuer} · ` : ""}{k.issued_on ? `issued ${k.issued_on}` : ""}
                {k.expires_on ? ` · expires ${k.expires_on}` : ""}
                {k.file_name ? ` · ${k.file_name}` : " · no document attached"}
              </span>
            </div>
          ))}

          {add === "1" && (
            <form action={saveCredential} style={{ display: "grid", gap: 8, borderTop: "1px solid #eef0ec", paddingTop: 10 }}>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cr-label">What is it</label>
                  <input id="cr-label" name="label" className="input" required
                    defaultValue={missing[0]?.license_label ?? ""} placeholder="NJ electrical contractor licence" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cr-trade">Trade</label>
                  <select id="cr-trade" name="trade" className="input" defaultValue={missing[0]?.trade ?? ""}>
                    <option value="">Not trade-specific</option>
                    {p.all_trades.map((t) => <option key={t.trade} value={t.trade}>{t.trade}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cr-kind">Kind</label>
                  <select id="cr-kind" name="kind" className="input" defaultValue="license">
                    {KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cr-number">Number</label>
                  <input id="cr-number" name="number" className="input" />
                </div>
              </div>
              <div className="form-2col">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cr-issuer">Issued by</label>
                  <input id="cr-issuer" name="issuer" className="input" placeholder="NJ Division of Consumer Affairs" />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="cr-exp">Expires</label>
                  <input id="cr-exp" name="expires_on" className="input" type="date" />
                </div>
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="cr-file">The document (PDF or photo)</label>
                <input id="cr-file" name="file" className="input" type="file" accept="image/*,application/pdf" />
              </div>
              <div className="btn-row"><button className="btn small">Save document</button></div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
