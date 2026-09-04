import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

type Milestone = {
  id: string; name: string | null; sequence_no: number | null; amount: number | null;
  percent_of_contract: number | null; trigger: string | null; due_on: string | null;
  status: string | null; requires_photo: boolean | null; paid_at: string | null;
  settlement_status: string | null; contract_title: string | null;
};
type Contract = {
  id: string; title: string | null; status: string | null; trade: string | null;
  amount: number | null; currency: string | null; signed_date: string | null;
  start_date: string | null; end_date: string | null; scope: string | null;
  net_days: number | null; deposit_pct: number | null; retainage_pct: number | null;
  retainage_release_trigger: string | null; consumables_by: string | null;
  finish_material_by: string | null; payment_terms_notes: string | null;
  coi_required: boolean; milestones: number;
};

const money = (n: number | null, cur = "USD") =>
  n == null ? "—" : `${cur === "USD" ? "$" : ""}${Math.round(n).toLocaleString()}`;
const paid = (s: string | null) => !!s && /paid|settled/i.test(s);

// What a contractor manager runs their side of the job from: the money by
// milestone, the scope they are held to, and the contract behind both.
export async function ContractorView({ projectId, show = "both" }: { projectId: string; show?: "payments" | "contract" | "both" }) {
  const supabase = await createClient();
  const [{ data: msData }, { data: coData }] = await Promise.all([
    supabase.rpc("portal_my_milestones", { p_project: projectId }),
    supabase.rpc("portal_my_contract", { p_project: projectId }),
  ]);
  const milestones = ((msData ?? []) as Milestone[]);
  const contracts = ((coData ?? []) as Contract[]);
  const due = milestones.filter((m) => !paid(m.status) && !paid(m.settlement_status));
  const owed = due.reduce((n, m) => n + (m.amount ?? 0), 0);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {show !== "contract" && (
      <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Payment milestones · {milestones.length}</h2>
          {due.length > 0 && <span className="small"><strong>{money(owed)}</strong> <span className="muted">still to come</span></span>}
        </div>
        {milestones.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            No milestones on your contract yet. They appear once the owner sets the payment schedule.
          </p>
        )}
        {milestones.map((m) => (
          <div key={m.id} className="small" style={{ display: "grid", gap: 2, borderTop: "1px solid #eef0ec", paddingTop: 6, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
              <span style={{ minWidth: 0 }}>
                {m.sequence_no != null && <span className="muted">{m.sequence_no}. </span>}
                <strong>{m.name ?? "Milestone"}</strong>
                {m.percent_of_contract != null && <span className="muted"> · {m.percent_of_contract}%</span>}
              </span>
              <span style={{ display: "inline-flex", gap: 6, alignItems: "center", whiteSpace: "nowrap" }}>
                <strong>{money(m.amount)}</strong>
                {paid(m.status) || paid(m.settlement_status)
                  ? <span className="extra-chip" style={{ background: "#e6f2ea", color: "#1f6b45" }}>paid</span>
                  : <span className="extra-chip">{m.status ?? "not due"}</span>}
              </span>
            </div>
            {m.trigger && <span className="muted" style={{ fontSize: 11 }}>Released when: {m.trigger}</span>}
            <span className="muted" style={{ fontSize: 11 }}>
              {m.due_on ? `Due ${m.due_on}` : "No date"}
              {m.requires_photo ? " · photo evidence required" : ""}
            </span>
          </div>
        ))}
      </div>
      )}

      {show !== "payments" && (
      <div className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your contract · {contracts.length}</h2>
          <Link href={`/my/project/${projectId}?tab=scope`} className="small">Scope &amp; evidence →</Link>
        </div>
        {contracts.length === 0 && (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing signed with you on this project yet.
          </p>
        )}
        {contracts.map((c) => (
          <details key={c.id} open={contracts.length === 1} style={{ borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
            <summary className="small" style={{ cursor: "pointer", display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
              <span><strong>{c.title ?? c.trade ?? "Contract"}</strong> <span className="muted">· {c.status}</span></span>
              <span style={{ whiteSpace: "nowrap" }}><strong>{money(c.amount, c.currency ?? "USD")}</strong></span>
            </summary>
            <div className="small" style={{ display: "grid", gap: 4, marginTop: 8 }}>
              {c.scope && <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{c.scope}</p>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
                {[
                  ["Signed", c.signed_date ?? "—"],
                  ["Starts", c.start_date ?? "—"],
                  ["Ends", c.end_date ?? "—"],
                  ["Terms", c.net_days != null ? `Net ${c.net_days}` : "—"],
                  ["Deposit", c.deposit_pct != null ? `${c.deposit_pct}%` : "—"],
                  ["Retainage", c.retainage_pct != null ? `${c.retainage_pct}%` : "—"],
                  ["Consumables", c.consumables_by ?? "—"],
                  ["Finish material", c.finish_material_by ?? "—"],
                ].map(([l, v]) => (
                  <div key={String(l)}>
                    <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{l}</div>
                    <div style={{ fontWeight: 600 }}>{v}</div>
                  </div>
                ))}
              </div>
              {c.retainage_release_trigger && <p className="muted" style={{ margin: 0, fontSize: 11 }}>Retainage released: {c.retainage_release_trigger}</p>}
              {c.payment_terms_notes && <p className="muted" style={{ margin: 0, fontSize: 11 }}>{c.payment_terms_notes}</p>}
            </div>
          </details>
        ))}
      </div>
      )}
    </div>
  );
}
