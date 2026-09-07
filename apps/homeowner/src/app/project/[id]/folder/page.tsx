import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBooking, signedUrls } from "@/lib/booking";
import { formsFor } from "@/lib/forms";
import { dayClock, dollars, shortDate } from "@shared/format";
import { AppBar, Blueprint, ChevronIcon, Screen } from "@shared/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Job folder" };

// Screen 13a - the job folder, visible to both sides: price & scope, photos,
// insurance, permit forms, milestone log, payment evidence. A timeline, not
// a filing cabinet; each row expands below.
export default async function FolderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, missing, supabase } = await getBooking(id);
  if (missing) redirect("/project");
  if (!b) notFound();
  const photos = b.files.filter((f) => f.kind === "photo");
  const urls = await signedUrls(supabase, photos.map((f) => f.path));
  const c = b.contractor;
  const first = c?.person?.split(" ")[0] ?? "the contractor";
  const doneNodes = b.progress.nodes.filter((n) => n.status === "done");
  const evidence = b.stages.flatMap((s) => s.evidence.map((e) => ({ ...e, stage: s.name })));
  const evUrls = await signedUrls(supabase, evidence.map((e) => e.path));
  const forms = formsFor(b.package?.trade ?? null, b.package_code);
  const paidStages = b.stages.filter((s) => s.status === "Paid" || s.settlement_status === "paid");

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="Job folder" right={c ? <span className="tag tag-neutral">You + {first} can both see this</span> : undefined} />
      <div className="body">
        <p className="small text-muted" style={{ margin: 0 }}>{b.address?.split(",")[0]}{c ? ` · with ${c.name}` : ""} · Everything about this job, in one place, for as long as you own the house.</p>
        <Blueprint pad={false}>
          <Row href="#scope" icon={<I d="M6 4h12v16H6zM9 9h6M9 13h6" />} title="Price & scope" meta={`${dollars(b.price_cents)} · ${b.config_label ?? ""} · ${b.scope.length} included items${b.state !== "posted" ? " · locked at acceptance" : ""}`} />
          <Row href="#photos" icon={<I d="M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />} title="Photos" meta={photos.length ? `${photos.length} · ${photos.filter((p) => p.by_me).length} from you, ${photos.filter((p) => !p.by_me).length} from ${first}` : "None yet — add them from the timeline"} empty={!photos.length} />
          <Row href="#insurance" icon={<I d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />} title="Insurance certificate" meta={c ? (c.insurance ? `${c.name} · ${c.insurance.coverage ?? "GL"}${c.insurance.limit ? ` $${Math.round(c.insurance.limit / 1e6)}M` : ""}${c.insurance.expires ? ` · valid through ${shortDate(c.insurance.expires)}` : ""}` : `${c.name} · certificate on file with Green Bergen`) : "Appears when a contractor accepts"} empty={!c} />
          {b.package?.requires_permit && <Row href={`/project/${id}/forms`} icon={<I d="M7 3h7l4 4v14H7zM14 3v4h4M9 12h6M9 16h6" />} title="Permit forms" meta={`${forms.length} form${forms.length === 1 ? "" : "s"} to sign at the meeting · NJ UCC`} tag="New" />}
          <Row href="#log" icon={<I d="M4 6h16M4 12h16M4 18h10" />} title="Milestone log" meta={`${doneNodes.length} of ${b.progress.total}${doneNodes.length ? ` · last: ${doneNodes[doneNodes.length - 1]!.name}, ${dayClock(doneNodes[doneNodes.length - 1]!.at)}` : ""}`} />
          <Row href="#evidence" icon={<I d="M3 7h18v10H3zM7 12h.01M17 12h.01M12 12a2 2 0 1 0 0-.01" />} title="Payment evidence" meta={evidence.length || paidStages.length ? `${paidStages.length} payment${paidStages.length === 1 ? "" : "s"} recorded · ${evidence.length} photo${evidence.length === 1 ? "" : "s"}` : `Nothing yet — the first payment is ${b.package?.requires_permit ? `${b.package.permit_deposit_pct}% at the permit meeting` : "on completion"}.`} empty={!evidence.length && !paidStages.length} />
        </Blueprint>

        <section id="scope" className="stack" style={{ gap: 6 }}>
          <div className="divider-label">Price &amp; scope</div>
          <Blueprint pad>
            <div className="between"><strong>{b.package?.name}</strong><strong className="mono">{dollars(b.price_cents)}</strong></div>
            <div className="small text-muted">{b.config_label} · estimate pending contractor confirmation</div>
            <ul className="scope" style={{ marginTop: 8 }}>
              {b.scope.map((s, i) => <li key={i}><span className="ic">·</span><span>{s.item}{s.detail && <span className="detail"> — {s.detail}</span>}</span></li>)}
            </ul>
          </Blueprint>
        </section>

        <section id="photos" className="stack" style={{ gap: 6 }}>
          <div className="divider-label">Photos</div>
          {photos.length === 0 ? <p className="small text-muted" style={{ margin: 0 }}>Nothing yet. Photos you send on the timeline land here too.</p> : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              {photos.map((f) => (
                <figure key={f.id} style={{ margin: 0 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {urls[f.path] ? <img src={urls[f.path]} alt={f.caption ?? "Photo"} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", border: "1px solid var(--color-divider)" }} /> : <div className="skel" style={{ aspectRatio: "1" }} />}
                  <figcaption className="tiny text-muted">{f.caption ?? "Photo"} · {f.by_me ? "you" : f.by} · {shortDate(f.created_at)}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>

        <section id="insurance" className="stack" style={{ gap: 6 }}>
          <div className="divider-label">Insurance</div>
          <p className="small text-muted" style={{ margin: 0 }}>{c ? `Green Bergen checks every contractor's certificate names the right legal entity before they take a job. ${c.insurance ? "The certificate on file is summarised above." : "A copy is available on request."}` : "Appears when a contractor accepts."}</p>
        </section>

        <section id="log" className="stack" style={{ gap: 6 }}>
          <div className="divider-label">Milestone log</div>
          <Blueprint pad={false}>
            <div className="kv-rows" style={{ padding: "4px 14px" }}>
              {b.progress.nodes.map((n) => (
                <div key={n.key}><span className={n.status === "done" ? "" : "k"}>{n.name}</span><span className="text-muted">{n.status === "done" ? dayClock(n.at) : n.status === "current" ? "next" : n.typical_range ?? "—"}</span></div>
              ))}
            </div>
          </Blueprint>
        </section>

        <section id="evidence" className="stack" style={{ gap: 6 }}>
          <div className="divider-label">Payment evidence</div>
          {paidStages.length === 0 && evidence.length === 0 ? <p className="small text-muted" style={{ margin: 0 }}>Nothing yet. When you pay {first}, the receipt or a photo of the check lands here.</p> : (
            <Blueprint pad={false}>
              <div className="kv-rows" style={{ padding: "4px 14px" }}>
                {b.stages.filter((s) => s.status !== "Planned").map((s) => (
                  <div key={s.id}><span>{s.name}</span><span>{dollars(s.amount_cents)} · {s.status === "Paid" || s.settlement_status === "paid" ? `paid ${shortDate(s.paid_at)}` : s.status.toLowerCase()}</span></div>
                ))}
              </div>
              {evidence.length > 0 && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, padding: 10 }}>
                  {evidence.map((e) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    evUrls[e.path] ? <img key={e.file_id} src={evUrls[e.path]} alt={e.stage} style={{ width: "100%", aspectRatio: "3/2", objectFit: "cover", border: "1px solid var(--color-divider)" }} /> : null
                  ))}
                </div>
              )}
            </Blueprint>
          )}
        </section>
      </div>
    </Screen>
  );
}

function Row({ href, icon, title, meta, tag, empty = false }: { href: string; icon: React.ReactNode; title: string; meta: string; tag?: string; empty?: boolean }) {
  return (
    <Link href={href} className={`frow ${empty ? "empty" : ""}`}>
      <span className="ic">{icon}</span>
      <span className="grow"><div className="t">{title}</div><div className="m">{meta}</div></span>
      {tag && <span className="tag tag-accent">{tag}</span>}
      <ChevronIcon />
    </Link>
  );
}

const I = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
