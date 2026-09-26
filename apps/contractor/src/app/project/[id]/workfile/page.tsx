import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { dollars, shortDate } from "@shared/format";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { workDetailRows, type WorkDetails } from "@shared/workDetails";
import { coverUrls } from "@/lib/board";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work file" };

// THE WORK FILE (Shahar, 2026-09-25): "as part of the work file these images
// should be visible." A job booked from a package, as the crew needs it on
// the day: the photos the homeowner took for each slot (the panel, the panel
// from a step back, the spot), anything else they added, what they told us
// (the EV charger's answers - work_details, migration 237) and the scope.
//
// One read, homeowner_booking(), which already answers any member of the job
// and keeps the owner's own facts and prices to the owner. The contractor is
// a member from the moment they accept, so this is theirs from then on; the
// price here is theirs (price_cents), never the homeowner's.
type Slot = { key: string; label: string; hint: string | null; file_id: string | null };
type File = { id: string; path: string; bucket: string; kind: string; mime: string | null; caption: string | null; created_at: string; by: string | null };
type Booking = {
  from_booking: boolean; project_name: string | null; address: string | null; unit: string | null;
  package: { name: string; tile_title: string } | null; price_cents: number; config_label: string | null;
  work_details: WorkDetails | null; photos: { slots: Slot[] } | null; files: File[];
  scope: { item: string; detail: string | null; kind: string }[];
};

export default async function WorkFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: b } = await rpc<Booking | null>(supabase, "homeowner_booking", { p_project: id });
  if (!b) notFound();

  const slots = b.photos?.slots ?? [];
  const byId = new Map(b.files.map((f) => [f.id, f]));
  const slotted = new Set(slots.map((s) => s.file_id).filter(Boolean));
  const photos = b.files.filter((f) => f.kind === "photo" && f.bucket === "project-media");
  const others = photos.filter((f) => !slotted.has(f.id));
  const urls = await coverUrls(supabase, photos.map((f) => f.path));
  const details = workDetailRows(b.work_details);
  const title = b.package?.name ?? b.project_name ?? "Work file";

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title={title} sub="Work file" />
      <div className="body">
        <div className="hero">
          <h1>Work file</h1>
          <p className="lead">
            {[b.address && `${b.address}${b.unit ? `, ${b.unit}` : ""}`, b.config_label].filter(Boolean).join(" · ")}
          </p>
        </div>

        {!b.from_booking && <Notice title="Not booked from a package.">This job was started by hand, so there is no photo request or questionnaire behind it.</Notice>}

        {slots.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <h6>The homeowner&apos;s photos</h6>
            {slots.map((s) => {
              const f = s.file_id ? byId.get(s.file_id) : undefined;
              const url = f ? urls[f.path] : undefined;
              return (
                <Card key={s.key} pad>
                  <div className="between"><strong>{s.label}</strong>{f && <span className="tiny text-muted">{shortDate(f.created_at)}</span>}</div>
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt={s.label} style={{ width: "100%", aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 14, display: "block" }} />
                    </a>
                  ) : (
                    <p className="small text-muted" style={{ margin: 0 }}>Not taken yet{s.hint ? ` — ${s.hint}` : "."} The homeowner has it as a request in their inbox.</p>
                  )}
                </Card>
              );
            })}
          </section>
        )}

        {others.length > 0 && (
          <section className="stack" style={{ gap: 8 }}>
            <h6>More photos on the job</h6>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
              {others.map((f) => urls[f.path] && (
                <a key={f.id} href={urls[f.path]} target="_blank" rel="noreferrer" title={f.caption ?? f.by ?? ""}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={urls[f.path]} alt={f.caption ?? "Job photo"} style={{ width: "100%", aspectRatio: "1", objectFit: "cover", borderRadius: 10, display: "block" }} />
                </a>
              ))}
            </div>
          </section>
        )}

        {details.length > 0 && (
          <Card pad>
            <div className="kicker">What the homeowner told us</div>
            <div className="kv-rows" style={{ padding: "2px 0" }}>
              {details.map((d) => <div key={d.label}><span className="k">{d.label}</span><span>{d.value}</span></div>)}
            </div>
            <p className="tiny text-muted" style={{ margin: 0 }}>Their words, before anyone looked. Confirm on the photos or on site.</p>
          </Card>
        )}

        {b.scope.length > 0 && (
          <Card pad>
            <div className="between"><div className="kicker">The scope</div>{b.from_booking && b.price_cents > 0 && <strong className="mono">{dollars(b.price_cents)}</strong>}</div>
            <ul className="scope" style={{ marginTop: 4 }}>
              {b.scope.map((s, i) => <li key={i}><span className="ic">·</span><span>{s.item}{s.detail ? <span className="text-muted"> — {s.detail}</span> : null}</span></li>)}
            </ul>
          </Card>
        )}

        <div className="actions" style={{ padding: 0 }}>
          <Link href={`/project/${id}`} className="btn btn-secondary btn-block">Back to the job</Link>
        </div>
      </div>
    </Screen>
  );
}
