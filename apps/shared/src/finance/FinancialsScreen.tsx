import { AppBar, Card, Notice, Screen } from "../ui";
import { shortDay } from "../format";
import { StageActions } from "./StageActions";
import { ChangeActions, ChangeOrderButton } from "./ChangeOrder";
import { StageSheetButton } from "./StageSheet";
import { changeTone, stageTone, usd, type FinContract, type FinEvidence, type Financials, type FinStage } from "./types";

// PROJECT MONEY - one screen for the payor, the payee, the investor and the
// owner, each seeing what rulebook 70 lets them see (project_financials
// decides; this file only draws what it was handed).
//
// Top to bottom: the three numbers (agreed, paid, still owed); then one
// card per contract - the milestones with what each side can do to them,
// the changes asked for and decided, the ledger of what actually moved;
// then the package bookings nobody holds yet, and the costs with no
// contract behind them. A payee sees only their own card.
export function FinancialsScreen({ fin, urls, back }: { fin: Financials; urls: Record<string, string>; back: string }) {
  if (!fin.ok) {
    return (
      <Screen>
        <AppBar back={back} title="Money" />
        <div className="body">
          <Notice kind="error" title="Not available.">{fin.reason}</Notice>
        </div>
      </Screen>
    );
  }
  const { project, me, totals, contracts, unassigned_stages: unassigned, other_costs: other, methods } = fin;
  const live = contracts.filter((c) => c.status !== "placeholder" && c.status !== "Cancelled");
  const pid = project.id;

  return (
    <Screen>
      <AppBar back={back} title="Money" sub={project.name} />
      <div className="body">
        {/* The three numbers. */}
        <Card pad={false}>
          <div className="promises fin-totals">
            <div><div className="t">{usd(totals.agreed)}</div><div className="d">agreed</div></div>
            <div><div className="t">{usd(totals.paid)}</div><div className="d">paid</div></div>
            <div><div className="t" style={{ color: totals.outstanding > 0 ? "var(--color-status)" : undefined }}>{usd(totals.outstanding)}</div><div className="d">still owed</div></div>
          </div>
          {(totals.retained > 0 || totals.requested > 0 || (me.all && totals.other_paid > 0)) && (
            <p className="tiny text-muted" style={{ margin: "0 14px 12px" }}>
              {[
                totals.retained > 0 ? `${usd(totals.retained)} retained` : null,
                totals.requested > 0 ? `${usd(totals.requested)} in changes awaiting a decision` : null,
                me.all && totals.other_paid > 0 ? `${usd(totals.other_paid)} paid outside any contract` : null,
              ].filter(Boolean).join(" · ")}
            </p>
          )}
        </Card>

        {!me.all && (
          <p className="tiny text-muted" style={{ margin: 0 }}>You see the contracts you are paid on. Green Bergen never holds the money; the owner pays you directly.</p>
        )}

        {live.length === 0 && unassigned.length === 0 && (
          <Card soft pad>
            <div className="card-title">Nothing to pay yet.</div>
            <p className="small text-muted" style={{ margin: "4px 0 0" }}>Contracts and their milestones appear here as they are awarded.</p>
          </Card>
        )}

        {live.map((c) => (
          <ContractCard key={c.id} c={c} me={me} methods={methods} urls={urls} projectId={c.project.id} showProject={c.project.id !== pid} />
        ))}

        {/* Booked, nobody holding it yet: the stages exist, the payee does not. */}
        {unassigned.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Booked, awaiting a contractor</div>
            <Card pad={false}>
              <div className="kv-rows" style={{ padding: "4px 14px" }}>
                {unassigned.map((s) => (
                  <div key={s.id}>
                    <span className="k">{s.project.name} · {s.name}</span>
                    <span>{usd(s.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <p className="tiny text-muted" style={{ margin: 0 }}>These become payable the moment a contractor accepts the job.</p>
          </section>
        )}

        {/* Money that has no contract behind it. */}
        {me.all && other && other.count > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <div className="divider-label">Other costs · {other.count}</div>
            <Card pad={false}>
              <div className="kv-rows" style={{ padding: "4px 14px" }}>
                {other.rows.map((t) => (
                  <div key={t.id}>
                    <span className="k" style={{ minWidth: 0 }}>
                      <span style={{ display: "block", color: "var(--color-text)" }}>{t.description}</span>
                      <span className="tiny">{[t.paid_on ? shortDay(t.paid_on) : null, t.method, t.category].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="mono" style={{ whiteSpace: "nowrap" }}>{usd(t.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
            <p className="tiny text-muted" style={{ margin: 0 }}>Suppliers, permits, one-off purchases: project spend that no contract carries. {usd(totals.other_paid)} in all.</p>
          </section>
        )}

        {contracts.length > live.length && (
          <p className="tiny text-muted" style={{ margin: 0 }}>{contracts.length - live.length} placeholder or cancelled {contracts.length - live.length === 1 ? "contract is" : "contracts are"} not shown.</p>
        )}
      </div>
    </Screen>
  );
}

function ContractCard({ c, me, methods, urls, projectId, showProject }: {
  c: FinContract; me: Extract<Financials, { ok: true }>["me"]; methods: Extract<Financials, { ok: true }>["methods"];
  urls: Record<string, string>; projectId: string; showProject: boolean;
}) {
  const agreed = c.totals.agreed;
  const paid = c.totals.paid;
  const pct = agreed > 0 ? Math.min(100, Math.round((paid / agreed) * 100)) : 0;
  const who = c.contractor?.name ?? c.contractor?.company ?? "—";
  const moved = c.transactions.filter((t) => t.moved);
  const planned = c.transactions.filter((t) => !t.moved);
  const stagesScheduled = c.stages.reduce((a, s) => a + (s.status === "Cancelled" ? 0 : (s.amount ?? 0)), 0);

  return (
    <Card pad>
      <div className="between" style={{ alignItems: "flex-start", gap: 8 }}>
        <div className="grow" style={{ minWidth: 0 }}>
          <div className="card-title">{c.title}</div>
          <div className="small text-muted">
            {[who, c.trade, showProject ? c.project.name : null, c.status].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="mono" style={{ fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 17, whiteSpace: "nowrap" }}>{usd(agreed)}</div>
      </div>

      <div className="fin-bar" aria-hidden><span style={{ width: `${pct}%` }} /></div>
      <div className="between tiny text-muted">
        <span>{usd(paid)} paid{c.totals.retained > 0 ? ` · ${usd(c.totals.retained)} retained` : ""}</span>
        <span>{agreed - paid > 0 ? `${usd(agreed - paid)} to go` : "settled"}</span>
      </div>
      {(c.retainage_pct || c.net_days || c.method) && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          {[c.method ? `Paid by ${c.method.toLowerCase()}` : null, c.net_days ? `net ${c.net_days}` : null, c.retainage_pct ? `${c.retainage_pct}% retainage` : null].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* MILESTONES */}
      <div className="divider-label" style={{ marginTop: 6 }}>Milestones{c.stages.length ? ` · ${c.stages.length}` : ""}</div>
      {c.stages.length === 0 ? (
        <p className="small text-muted" style={{ margin: 0 }}>
          {me.may_record ? "No payment schedule yet. Add the milestones the contract names." : "The owner has not set the payment schedule yet."}
        </p>
      ) : (
        <div className="fin-rows">
          {c.stages.map((s) => (
            <StageRow key={s.id} s={s} c={c} me={me} methods={methods} urls={urls} projectId={projectId} />
          ))}
        </div>
      )}
      {c.stages.length > 0 && agreed > 0 && Math.abs(stagesScheduled - agreed) > 0.5 && me.may_record && (
        <p className="tiny text-muted" style={{ margin: 0 }}>The milestones add up to {usd(stagesScheduled)} against {usd(agreed)} agreed.</p>
      )}
      {me.may_record && <StageSheetButton contractId={c.id} contractAmount={c.amount} label="Add a milestone" className="btn btn-ghost small" />}

      {/* CHANGES */}
      <div className="divider-label" style={{ marginTop: 6 }}>Changes{c.change_orders.length ? ` · ${c.change_orders.length}` : ""}</div>
      {c.change_orders.length === 0 && (
        <p className="small text-muted" style={{ margin: 0 }}>Nothing added to the contract{c.payee || me.may_record ? " yet. Extra material or work the scope did not carry goes here, with the receipt and a photo." : "."}</p>
      )}
      {c.change_orders.map((co) => {
        const tone = changeTone(co);
        return (
          <div key={co.id} className="fin-change">
            <div className="between" style={{ alignItems: "flex-start", gap: 8 }}>
              <div className="grow" style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{co.title}</div>
                {co.scope && <div className="small text-muted">{co.scope}</div>}
                <div className="tiny text-muted">{shortDay(co.created_at)}{co.notes ? ` · ${firstLine(co.notes)}` : ""}</div>
              </div>
              <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                <div className="mono" style={{ fontWeight: 800 }}>+{usd(co.amount)}</div>
                <span className={`tag ${tone.cls}`}>{tone.label}</span>
              </div>
            </div>
            <Thumbs items={co.evidence} urls={urls} />
            <ChangeActions change={co} mayRecord={me.may_record} payee={c.payee} />
          </div>
        );
      })}
      {(c.payee || me.may_record) && (
        <ChangeOrderButton contractId={c.id} contractTitle={c.title} projectId={projectId} mayRecord={me.may_record} />
      )}

      {/* THE LEDGER */}
      {(moved.length > 0 || planned.length > 0) && (
        <details className="fin-ledger">
          <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
            Ledger · {moved.length} {moved.length === 1 ? "payment" : "payments"}{planned.length ? `, ${planned.length} planned` : ""}
          </summary>
          <div className="kv-rows" style={{ marginTop: 6 }}>
            {[...moved, ...planned].map((t) => (
              <div key={t.id}>
                <span className="k" style={{ minWidth: 0 }}>
                  <span style={{ display: "block", color: "var(--color-text)" }}>{t.description}{t.change_order ? " (change)" : ""}</span>
                  <span className="tiny">
                    {[t.paid_on ? shortDay(t.paid_on) : t.target_date ? `planned ${shortDay(t.target_date)}` : null, t.method, t.reference ? `#${t.reference}` : null, t.status].filter(Boolean).join(" · ")}
                  </span>
                  {t.attachments.length > 0 && (
                    <span className="fin-thumbs" style={{ marginTop: 4 }}>
                      {t.attachments.map((a) => urls[a.path]
                        ? <a key={a.file_id} href={urls[a.path]} target="_blank" rel="noreferrer" className="tag tag-outline">{a.kind === "photo" ? "photo" : a.file_name ?? "file"}</a>
                        : null)}
                    </span>
                  )}
                </span>
                <span className="mono" style={{ whiteSpace: "nowrap", color: t.moved ? undefined : "var(--muted)" }}>{usd(t.moved ? t.amount : t.target_amount ?? t.amount)}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </Card>
  );
}

function StageRow({ s, c, me, methods, urls, projectId }: {
  s: FinStage; c: FinContract; me: Extract<Financials, { ok: true }>["me"]; methods: Extract<Financials, { ok: true }>["methods"];
  urls: Record<string, string>; projectId: string;
}) {
  const tone = stageTone(s);
  const paid = s.settlement_status === "paid" || s.status === "Paid";
  const tx = s.transaction;
  const waiting = paid && tx?.confirm_task;
  return (
    <div className="fin-row">
      <span className="n">{s.sequence_no ?? "·"}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="between" style={{ alignItems: "flex-start", gap: 8 }}>
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}</div>
            {s.trigger && <div className="small text-muted">{s.trigger}</div>}
            <div className="tiny text-muted">
              {[
                s.due_on && !paid ? `due ${shortDay(s.due_on)}` : null,
                paid && s.settlement ? `${s.settlement.method ?? "paid"}${s.settlement.reference ? ` #${s.settlement.reference}` : ""} · ${shortDay(s.settlement.paid_on ?? s.paid_at)}` : null,
                waiting ? `awaiting ${(c.contractor?.name ?? "the contractor").split(/\s+/)[0]}'s confirmation` : null,
                paid && tx?.status === "paid - receipt filed" ? "receipt confirmed" : null,
                s.retainage_withheld ? `${usd(s.retainage_withheld)} retained` : null,
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
            <div className="mono" style={{ fontWeight: 800 }}>{usd(s.amount)}</div>
            <span className={`tag ${tone.cls}`}>{tone.label}</span>
          </div>
        </div>
        <Thumbs items={s.evidence} urls={urls} />
        <div className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <StageActions stage={s} contractId={c.id} contractorName={c.contractor?.name ?? null} projectId={projectId}
            mayRecord={me.may_record} payee={c.payee} isSuperadmin={me.is_superadmin} methods={methods} />
          {me.may_record && !paid && s.status !== "Cancelled" && (
            <StageSheetButton contractId={c.id} contractAmount={c.amount} stage={s} label="Edit" className="btn btn-ghost small" />
          )}
        </div>
      </div>
    </div>
  );
}

// The photographs and files on a milestone or a change, signed for this
// screen only. A photo is a thumbnail; anything else is a chip.
function Thumbs({ items, urls }: { items: FinEvidence[]; urls: Record<string, string> }) {
  if (items.length === 0) return null;
  return (
    <div className="fin-thumbs">
      {items.map((e) => {
        const url = urls[e.path];
        if (!url) return <span key={e.file_id} className="tag tag-neutral">{e.file_name ?? e.kind ?? "file"}</span>;
        if (e.kind === "photo") {
          // eslint-disable-next-line @next/next/no-img-element
          return <a key={e.file_id} href={url} target="_blank" rel="noreferrer"><img src={url} alt={e.file_name ?? ""} loading="lazy" /></a>;
        }
        return <a key={e.file_id} href={url} target="_blank" rel="noreferrer" className="tag tag-outline">{e.kind === "audio" ? "voice note" : e.kind === "document" ? (e.role === "invoice" ? "receipt" : "document") : e.file_name ?? "file"}</a>;
      })}
    </div>
  );
}

const firstLine = (s: string) => s.split(/\r?\n/)[0] ?? "";
