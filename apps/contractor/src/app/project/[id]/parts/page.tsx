import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import type { Target } from "@shared/inbox/data";
import { savePart, saveWorkmanship } from "./actions";
import { AddPartPhoto } from "./AddPartPhoto";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parts & warranty" };

// WHAT WAS INSTALLED, AND WHAT IS STILL COVERED.
//
// Shahar (2026-09-22): "list of all parts registered and warranty.
// workmanship warranty transferrable to owner." Then: "each project needs to
// have a list of assets, including: installation date, installed by, part
// number, serial number, warranty, image installed... contractor to have an
// interface to log all this information, so we push the work to him."
//
// THIS IS THAT INTERFACE, and pushing the work to the trade is the point:
// the person holding the box the thing came in is the only person who can
// read the plate without climbing back up to it. Migration 232 puts the
// requirement in every trade's contract (blueprint_trade, the ALL bucket),
// so it is agreed before anybody signs rather than discovered at the end.
//
// A PART OUTLIVES THE JOB. It hangs off the HOUSE, not the project, because
// a warranty that expires with the project is not a warranty - the next job
// at the same address, and whoever owns it in five years, reads the same
// register.
//
// TWO HALVES, AND THEY ARE DIFFERENT PROMISES. The manufacturer's warranty
// comes with the box; the WORKMANSHIP warranty is the contractor's own, and
// whether it follows the house to the next owner is the question Shahar
// named. Nothing said is shown as nothing said, never as "no".

type Photo = { file_id: string; file_name: string; kind: string | null; mime: string | null; bucket: string; path: string; at: string };
type Part = {
  id: string; name: string; serial: string | null; room: string | null; where: string | null;
  installed_on: string | null; warranty_length: string | null; warranty_start: string | null;
  registered: boolean; transferable: boolean; doc_url: string | null; status: string | null;
  manufacturer: string | null; model: string | null; part_number: string | null;
  spec_url: string | null; trade: string | null;
  installed_by: string | null; installed_by_contact_id: string | null;
  photos: Photo[];
};
type Work = {
  id: string; title: string | null; trade: string | null; status: string | null; project_id: string;
  covers: string | null; months: number | null; transferable: boolean | null;
  claim_contact: string | null; party: string | null; answered: boolean;
};
type Register = {
  house_asset_id: string | null; house: string | null; can_register: boolean;
  parts_n: number; registered_n: number; transfers_n: number;
  parts: Part[]; workmanship: Work[]; workmanship_n: number; workmanship_answered: number;
};

export default async function PartsPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; open?: string }>;
}) {
  const { id } = await params;
  const { ok, error, open } = await searchParams;

  const w = stopwatch("/project/[id]/parts");
  const supabase = await createClient();
  const [board, { data }, { data: mayEdit }, { data: targetData }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("register", () => rpc<Register>(supabase, "portal_warranties", { p_project: id })),
    w.step("mayEdit", () => rpc<boolean>(supabase, "can_edit_project", { p_project_id: id })),
    w.step("people", () => rpc<Target[]>(supabase, "portal_compose_targets")),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/parts`)}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const reg = data ?? null;
  if (!reg) notFound();
  const canEdit = mayEdit === true && reg.can_register;

  const people = (Array.isArray(targetData) ? targetData : []).find((x) => x.project_id === id)?.people
    ?? (Array.isArray(targetData) ? targetData : []).flatMap((x) => x.people);

  // One signed URL per photograph, asked for together.
  const urls = new Map<string, string>();
  await w.step("urls", async () => {
    const files = reg.parts.flatMap((p) => p.photos ?? []);
    await Promise.all(files.map(async (p) => {
      const { data: signed } = await supabase.storage.from(p.bucket).createSignedUrl(p.path, 3600);
      if (signed?.signedUrl) urls.set(p.file_id, signed.signedUrl);
    }));
  });
  w.done();

  // What is missing, counted the way a handover pack is checked: a part with
  // no serial or no photograph is a part somebody will have to go back for.
  const thin = reg.parts.filter((p) => !p.serial || (p.photos ?? []).length === 0).length;

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="Parts & warranty" sub={reg.house ?? seat.project_name} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}

        {!reg.can_register && (
          <Notice kind="error" title="This job is not attached to a property.">
            A part is installed in a house, and the register belongs to the house so it outlives the
            job. Until this job names its property there is nowhere to keep it.
          </Notice>
        )}

        <div className="hero">
          <h1>{reg.parts_n} {reg.parts_n === 1 ? "part" : "parts"}</h1>
          <p className="lead">
            {reg.parts_n === 0
              ? "Nothing registered yet. Every piece of equipment installed here belongs on this list."
              : `${reg.registered_n} registered with the manufacturer · ${reg.transfers_n} transfer to the owner${thin ? ` · ${thin} still missing a serial or a photo` : ""}.`}
          </p>
        </div>

        <p className="small text-muted" style={{ margin: 0 }}>
          Read the numbers off the <strong>plate on the machine</strong> and photograph it where it
          sits. This is in every trade&rsquo;s contract, so it is the trade that did the work who
          fills it in — not somebody typing up a pile of paperwork afterwards.
        </p>

        {/* ── THE PARTS ── */}
        {reg.parts.map((p) => {
          const shots = p.photos ?? [];
          const gap = !p.serial || shots.length === 0;
          return (
            <Card pad className="tight" key={p.id}>
              <details open={open === p.id}>
                <summary className="between" style={{ gap: 8, cursor: "pointer", alignItems: "baseline" }}>
                  <span className="grow small" style={{ minWidth: 0 }}>
                    <span style={{ marginRight: 6, color: gap ? "var(--color-soon)" : "var(--color-ok)" }}>●</span>
                    <strong>{p.name}</strong>
                    {p.model ? <span className="text-muted"> · {[p.manufacturer, p.model].filter(Boolean).join(" ")}</span> : null}
                  </span>
                  <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>
                    {p.serial ? p.serial : "no serial"}{shots.length ? ` · ${shots.length} photo` : ""}
                  </span>
                </summary>
                <PartForm projectId={id} part={p} people={people} canEdit={canEdit} />
                <div className="stack" style={{ gap: 4, marginTop: 8 }}>
                  <div className="divider-label">Installed{shots.length > 0 ? ` · ${shots.length}` : ""}</div>
                  {shots.length > 0 && (
                    <div className="chips" style={{ gap: 6 }}>
                      {shots.map((s) => {
                        const url = urls.get(s.file_id);
                        return url && (s.kind === "photo" || (s.mime ?? "").startsWith("image/")) ? (
                          <a href={url} key={s.file_id} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt={s.file_name} width={72} height={72}
                              style={{ objectFit: "cover", borderRadius: 8, display: "block" }} />
                          </a>
                        ) : (
                          <a className="tag tag-neutral" href={url ?? "#"} key={s.file_id}
                             target="_blank" rel="noreferrer">{s.file_name}</a>
                        );
                      })}
                    </div>
                  )}
                  {canEdit && <AddPartPhoto projectId={id} partId={p.id} label={p.name} />}
                </div>
              </details>
            </Card>
          );
        })}

        {/* ── ONE MORE ── */}
        {canEdit && (
          <Card soft pad>
            <details open={reg.parts_n === 0}>
              <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>
                ＋ Register a part
              </summary>
              <PartForm projectId={id} part={null} people={people} canEdit />
            </details>
          </Card>
        )}

        {/* ── WORKMANSHIP ── */}
        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">
            Workmanship warranty · {reg.workmanship_answered} of {reg.workmanship_n} answered
          </div>
          <p className="small text-muted" style={{ margin: 0 }}>
            The contractor&rsquo;s own promise, not the manufacturer&rsquo;s — and whether it follows
            the house to whoever owns it next. Left unanswered it stays unanswered here: a handover
            pack that quietly says no is worse than one that says nobody asked.
          </p>
          {reg.workmanship.length === 0 && (
            <p className="small text-muted" style={{ margin: 0 }}>
              No contracts on this job yet.
            </p>
          )}
          {reg.workmanship.map((c) => (
            <Card pad className="tight" key={c.id}>
              <details open={open === c.id}>
                <summary className="between" style={{ gap: 8, cursor: "pointer", alignItems: "baseline" }}>
                  <span className="grow small" style={{ minWidth: 0 }}>
                    <span style={{ marginRight: 6, color: c.answered ? "var(--color-ok)" : "var(--muted)" }}>
                      {c.answered ? "●" : "○"}
                    </span>
                    <strong>{c.title ?? "Untitled contract"}</strong>
                    {c.party ? <span className="text-muted"> · {c.party}</span> : null}
                  </span>
                  <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>
                    {!c.answered ? "not answered"
                      : c.transferable === true ? `${c.months ?? "?"} mo · transfers`
                      : c.transferable === false ? `${c.months ?? "?"} mo · does not transfer`
                      : `${c.months ?? "?"} mo`}
                  </span>
                </summary>
                <form action={saveWorkmanship.bind(null, id)} className="stack" style={{ gap: 8, marginTop: 8 }}>
                  <input type="hidden" name="contract_id" value={c.id} />
                  <div className="row" style={{ gap: 8 }}>
                    <label className="field grow" style={{ minWidth: 0 }}>
                      <span className="field-label">How long (months)</span>
                      <input className="input" name="months" inputMode="numeric"
                        defaultValue={c.months != null ? String(c.months) : ""} placeholder="12 · 24 · 120" />
                    </label>
                    <label className="field grow" style={{ minWidth: 0 }}>
                      <span className="field-label">Who to call on a claim</span>
                      <input className="input" name="claim_contact" defaultValue={c.claim_contact ?? ""}
                        placeholder="Name and number" />
                    </label>
                  </div>
                  <label className="field">
                    <span className="field-label">What it covers</span>
                    <input className="input" name="covers" defaultValue={c.covers ?? ""}
                      placeholder="Labour on the work in this contract — leaks, fixings, finish" />
                  </label>
                  <div className="field">
                    <span className="field-label">Transfers to the owner?</span>
                    <div className="seg" role="radiogroup" aria-label="Does it transfer">
                      <label className="seg-opt">
                        <input type="radio" name="transferable" value="yes" defaultChecked={c.transferable === true} />
                        <span>Yes</span>
                      </label>
                      <label className="seg-opt">
                        <input type="radio" name="transferable" value="no" defaultChecked={c.transferable === false} />
                        <span>No</span>
                      </label>
                      <label className="seg-opt">
                        <input type="radio" name="transferable" value="" defaultChecked={c.transferable == null} />
                        <span>Not asked</span>
                      </label>
                    </div>
                  </div>
                  {canEdit && <button className="btn btn-primary btn-block">Save this warranty</button>}
                </form>
              </details>
            </Card>
          ))}
        </section>

        <Link href={`/project/${id}`} className="small" style={{ alignSelf: "flex-start" }}>
          ← Back to the job
        </Link>
      </div>
    </Screen>
  );
}

/** The six things every trade hands over, plus where the thing sits. */
function PartForm({ projectId, part, people, canEdit }: {
  projectId: string; part: Part | null;
  people: { contact_id: string; name: string }[]; canEdit: boolean;
}) {
  const p = part;
  return (
    <form action={savePart.bind(null, projectId)} className="stack" style={{ gap: 8, marginTop: 8 }}>
      {p && <input type="hidden" name="id" value={p.id} />}

      <label className="field">
        <span className="field-label">What it is <span className="req">required</span></span>
        <input className="input" name="name" defaultValue={p?.name ?? ""} required maxLength={200}
          placeholder="Standby generator · Water heater · Transfer switch" />
      </label>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Make</span>
          <input className="input" name="manufacturer" defaultValue={p?.manufacturer ?? ""} placeholder="Generac" />
        </label>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Model</span>
          <input className="input" name="model" defaultValue={p?.model ?? ""} placeholder="7043" />
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Part number</span>
          <input className="input" name="part_number" defaultValue={p?.part_number ?? ""} placeholder="Off the plate" />
        </label>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Serial number</span>
          <input className="input" name="serial" defaultValue={p?.serial ?? ""} placeholder="Off the plate" />
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Installed on</span>
          <input className="input" type="date" name="installed_on" defaultValue={p?.installed_on ?? ""} />
        </label>
        <label className="field grow" style={{ minWidth: 0 }}>
          {/* WHO PUT IT IN. A serial number says what failed; this says whose
              warranty answers for it. */}
          <span className="field-label">Installed by</span>
          <select className="input" name="installed_by" defaultValue={p?.installed_by_contact_id ?? ""}>
            <option value="">— not recorded —</option>
            {people.map((x) => <option key={x.contact_id} value={x.contact_id}>{x.name}</option>)}
          </select>
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Trade</span>
          <input className="input" name="trade" defaultValue={p?.trade ?? ""} placeholder="Electrical" />
        </label>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Where it sits</span>
          <input className="input" name="where" defaultValue={p?.where ?? ""} placeholder="Side yard pad · Basement" />
        </label>
      </div>

      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Warranty</span>
          <input className="input" name="warranty_length" defaultValue={p?.warranty_length ?? ""}
            placeholder="5 years · 10 years parts, 1 labour" />
        </label>
        <label className="field grow" style={{ minWidth: 0 }}>
          <span className="field-label">Starts</span>
          <input className="input" type="date" name="warranty_start" defaultValue={p?.warranty_start ?? ""} />
        </label>
      </div>

      <label className="field">
        <span className="field-label">Warranty document</span>
        <input className="input" name="doc_url" defaultValue={p?.doc_url ?? ""} placeholder="https://…" />
      </label>

      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="registered" defaultChecked={p?.registered ?? false} style={{ marginTop: 3 }} />
        <span>
          Registered with the manufacturer
          <span className="text-muted"> — most warranties are only worth their term once somebody has.</span>
        </span>
      </label>
      <label className="row small" style={{ gap: 8, alignItems: "flex-start" }}>
        <input type="checkbox" name="transferable" defaultChecked={p?.transferable ?? false} style={{ marginTop: 3 }} />
        <span>
          Transfers to the owner
          <span className="text-muted"> — it follows the house rather than the person who bought it.</span>
        </span>
      </label>

      {canEdit && (
        <button className="btn btn-primary btn-block">{p ? "Save this part" : "Register it"}</button>
      )}
    </form>
  );
}
