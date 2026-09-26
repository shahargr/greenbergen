import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import { saveAppliance } from "./actions";
import { AddPlate } from "./AddPlate";

export const dynamic = "force-dynamic";
export const metadata = { title: "What the house burns" };

// WHAT THE HOUSE ALREADY BURNS.
//
// Shahar (2026-09-21): "where the scope of the project is defined, the user
// should be asked to upload info on existing gas devices: images and model
// numbers... this info be sent along the bid."
//
// This is not a form for the sake of a form. The generator process turns on
// it twice: step 10 totals the connected load, and step 20 asks whether the
// meter carries the house PLUS the generator. Answer 20 with a total that is
// too small and the utility has to upsize the meter - weeks at best, a season
// at worst, and found out late.
//
// THREE ANSWERS PER APPLIANCE, not two. "There is no pool heater" is a real
// answer and the commonest one; it is not the same as nobody having looked.
// A plumber reading "not answered" knows to ask. A plumber reading "none"
// does not. So the screen never quietly turns silence into a no.
//
// IT TRAVELS WITH THE BID BY ITSELF. portal_gas_survey lets an invited bidder
// read it, the same way portal_scope_evidence already lets one read the scope
// photos - so there is nothing to attach or forward, and no second copy that
// can go stale.

type Photo = {
  file_id: string; file_name: string; kind: string | null; mime: string | null;
  bucket: string; path: string; role: string; at: string;
};

type Row = {
  kind: string; label: string; hint: string | null;
  typical_low: number | null; typical_high: number | null;
  id: string | null; present: boolean | null;
  manufacturer: string | null; model: string | null;
  input_btuh: number | null; fuel: string | null;
  location: string | null; note: string | null;
  surveyed_at: string | null; surveyed_by: string | null;
  photos: Photo[];
};

type Survey = {
  asset_id: string | null; house: string | null; can_survey: boolean; asked: boolean;
  of: number; answered: number; present_n: number; rated_n: number;
  total_btuh: number; total_is_partial: boolean; rows: Row[];
};

const btu = (n: number | null | undefined) =>
  n == null ? "—" : `${Math.round(n).toLocaleString("en-US")} BTU/hr`;

export default async function GasSurveyPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; open?: string }>;
}) {
  const { id } = await params;
  const { ok, error, open } = await searchParams;

  const w = stopwatch("/project/[id]/scope/gas");
  const supabase = await createClient();
  const [board, { data }, { data: mayEdit }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("survey", () => rpc<Survey>(supabase, "portal_gas_survey", { p_project: id })),
    w.step("mayEdit", () => rpc<boolean>(supabase, "can_edit_project", { p_project_id: id })),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/scope/gas`)}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const survey = data ?? null;
  if (!survey) notFound();
  const canEdit = mayEdit === true && survey.can_survey;

  // One signed URL per plate photograph, asked for together. Only this screen
  // pays for them; the scope wizard never touches storage.
  const urls = new Map<string, string>();
  await w.step("urls", async () => {
    const files = survey.rows.flatMap((r) => r.photos ?? []);
    await Promise.all(files.map(async (p) => {
      const { data: signed } = await supabase.storage.from(p.bucket).createSignedUrl(p.path, 3600);
      if (signed?.signedUrl) urls.set(p.file_id, signed.signedUrl);
    }));
  });
  w.done();

  const left = survey.of - survey.answered;

  return (
    <Screen>
      <AppBar back={`/project/${id}/scope`} title="What the house burns" sub={survey.house ?? seat.project_name} />
      <div className="body">
        {ok && <div className="banner-ok">{ok}</div>}
        {error && <Notice kind="error">{error}</Notice>}

        {!survey.can_survey && (
          <Notice kind="error" title="This job is not attached to a property.">
            The survey belongs to the house, not the job, so there is nowhere to keep it until this job
            names its property.
          </Notice>
        )}

        <div className="hero">
          <h1>{btu(survey.total_btuh)}</h1>
          <p className="lead">
            {survey.answered === 0
              ? `Nothing answered yet — ${survey.of} appliances to go through.`
              : left > 0
                ? `${survey.answered} of ${survey.of} answered, ${survey.present_n} of them here. ${left} still to go.`
                : survey.total_is_partial
                  ? `All ${survey.of} answered, but ${survey.present_n - survey.rated_n} of the ones that are here have no rating on them yet.`
                  : `All ${survey.of} answered. This is the whole connected load.`}
          </p>
        </div>

        {/* THE NUMBER IS NOT THE ANSWER UNTIL IT IS. Saying "partial" out loud
            is the entire point - a total that is quietly short is how the
            meter question gets answered wrong. */}
        {survey.total_is_partial ? (
          <Notice kind="info" title="This total is not the whole load yet.">
            Add the generator&apos;s own draw to it and compare against the meter&apos;s badge. A 22 kW
            Generac on natural gas is roughly 300,000 BTU/hr, and a standard residential meter delivers
            on the order of 250,000 — so a house plus a generator usually needs the meter looked at.
            Do not answer that question off a total with gaps in it.
          </Notice>
        ) : (
          <Notice kind="info" title="Every appliance is accounted for.">
            Add the generator&apos;s draw to this and you have what the meter has to carry.
          </Notice>
        )}

        <p className="small text-muted" style={{ margin: 0 }}>
          Read every number off the <strong>plate on the machine</strong>, not off a spec sheet for a
          similar model, and use the <strong>input</strong> rating rather than the output — the input is
          what the meter has to deliver. Photograph each plate: the numbers get argued about later and a
          photograph ends it. Whatever is here goes to the trades you invite to quote.
        </p>

        {survey.rows.map((r) => {
          const shots = r.photos ?? [];
          const answered = r.present != null;
          const needsPlate = r.present === true && (r.input_btuh == null || shots.length === 0);
          return (
            <Card pad className="tight" key={r.kind}>
              <details open={open === r.kind || (!answered && open == null)}>
                <summary className="between" style={{ gap: 8, cursor: "pointer", alignItems: "baseline" }}>
                  <span className="grow small" style={{ minWidth: 0 }}>
                    <span
                      style={{
                        marginRight: 6,
                        color: !answered ? "var(--muted)"
                          : r.present === false ? "var(--color-ok)"
                          : needsPlate ? "var(--color-soon)" : "var(--color-ok)",
                      }}
                    >
                      {!answered ? "○" : "●"}
                    </span>
                    <strong>{r.label}</strong>
                  </span>
                  <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>
                    {!answered ? "not answered"
                      : r.present === false ? "none"
                      : r.input_btuh != null ? btu(r.input_btuh) : "here, no rating"}
                  </span>
                </summary>

                <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                  {r.hint && <p className="tiny text-muted" style={{ margin: 0 }}>{r.hint}</p>}

                  <form action={saveAppliance.bind(null, id)} className="stack" style={{ gap: 8 }}>
                    <input type="hidden" name="kind" value={r.kind} />

                    <div className="field">
                      <span className="field-label">Is there one? <span className="req">required</span></span>
                      <div className="seg" role="radiogroup" aria-label={`Is there a ${r.label}`}>
                        <label className="seg-opt">
                          <input type="radio" name="present" value="yes" defaultChecked={r.present === true} />
                          <span>Yes</span>
                        </label>
                        <label className="seg-opt">
                          <input type="radio" name="present" value="no" defaultChecked={r.present === false} />
                          <span>None</span>
                        </label>
                        <label className="seg-opt">
                          <input type="radio" name="present" value="" defaultChecked={r.present == null} />
                          <span>Not looked</span>
                        </label>
                      </div>
                    </div>

                    {/* The detail fields stay on the page whatever the answer.
                        Hiding them behind the radio would need client state for
                        a form that saves in one press, and the database drops
                        whatever is typed against a "none" anyway. */}
                    <div className="row" style={{ gap: 8 }}>
                      <label className="field grow" style={{ minWidth: 0 }}>
                        <span className="field-label">Make</span>
                        <input className="input" name="manufacturer" defaultValue={r.manufacturer ?? ""}
                          placeholder="Carrier · Rheem · Wolf" />
                      </label>
                      <label className="field grow" style={{ minWidth: 0 }}>
                        <span className="field-label">Model</span>
                        <input className="input" name="model" defaultValue={r.model ?? ""} placeholder="Off the plate" />
                      </label>
                    </div>

                    <div className="row" style={{ gap: 8 }}>
                      <label className="field grow" style={{ minWidth: 0 }}>
                        <span className="field-label">Input rating</span>
                        <input className="input" name="input_btuh" inputMode="numeric"
                          defaultValue={r.input_btuh != null ? String(Math.round(r.input_btuh)) : ""}
                          placeholder={r.typical_low != null ? `${r.typical_low.toLocaleString("en-US")}` : "BTU/hr"} />
                        <span className="hint">
                          {r.typical_low != null && r.typical_high != null
                            ? `BTU per hour. Typically ${r.typical_low.toLocaleString("en-US")}–${r.typical_high.toLocaleString("en-US")} — well outside that and you may have read the output.`
                            : "BTU per hour, input not output."}
                        </span>
                      </label>
                      <label className="field grow" style={{ minWidth: 0 }}>
                        <span className="field-label">Fuel</span>
                        <select className="input" name="fuel" defaultValue={r.fuel ?? ""}>
                          <option value="">— not set —</option>
                          <option value="natural gas">Natural gas</option>
                          <option value="propane">Propane</option>
                        </select>
                      </label>
                    </div>

                    <label className="field">
                      <span className="field-label">Where it is</span>
                      <input className="input" name="location" defaultValue={r.location ?? ""}
                        placeholder="Basement · Garage · Back patio" />
                    </label>

                    <label className="field">
                      <span className="field-label">Anything else</span>
                      <input className="input" name="note" defaultValue={r.note ?? ""}
                        placeholder="A second unit, a conversion, something due for replacement" />
                    </label>

                    {canEdit && <button className="btn btn-primary btn-block">Save {r.label.toLowerCase()}</button>}
                  </form>

                  {/* THE PLATE. Only once there is a row to hang it on - the
                      appliance has to be saved before a photograph can point
                      at it. */}
                  <div className="stack" style={{ gap: 4 }}>
                    <div className="divider-label">
                      Rating plate{shots.length > 0 ? ` · ${shots.length}` : ""}
                    </div>
                    {shots.length > 0 && (
                      <div className="chips" style={{ gap: 6 }}>
                        {shots.map((p) => {
                          const url = urls.get(p.file_id);
                          return url && (p.kind === "photo" || (p.mime ?? "").startsWith("image/")) ? (
                            <a href={url} key={p.file_id} target="_blank" rel="noreferrer">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt={p.file_name} width={72} height={72}
                                style={{ objectFit: "cover", borderRadius: 8, display: "block" }} />
                            </a>
                          ) : (
                            <a className="tag tag-neutral" href={url ?? "#"} key={p.file_id}
                               target="_blank" rel="noreferrer">{p.file_name}</a>
                          );
                        })}
                      </div>
                    )}
                    {canEdit && r.id && <AddPlate projectId={id} applianceId={r.id} label={r.label} />}
                    {canEdit && !r.id && (
                      <p className="tiny text-muted" style={{ margin: 0 }}>
                        Answer and save first — then there is something for the photograph to belong to.
                      </p>
                    )}
                  </div>
                </div>
              </details>
            </Card>
          );
        })}

        <Link href={`/project/${id}/scope`} className="small" style={{ alignSelf: "flex-start" }}>
          ← Back to the scope
        </Link>
      </div>
    </Screen>
  );
}
