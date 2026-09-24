"use client";

import { useRef } from "react";
import { configLabel, deltaNotes, isHardware, priceFor, type GasKind, type Lever, type Package, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { PriceBlock } from "@shared/PriceBlock";
import { AppBar, Card, CheckIcon, Notice, Screen, StepKicker } from "@shared/ui";

// THE THREE STEPS BEFORE A GAS JOB'S PRICE (Shahar, 2026-09-24, a three-phone
// mock-up of the emergency power flow; migration 235).
//
//   1  Scope & sizing      the levers that size the job, the distance to the
//                          panel, and which gas appliances the house has
//   2  Appliance details   a spec-plate photo or a product link for each
//   3  Installation        the distance from the meter, one wide context
//                          shot, and turn-key or DIY-assisted
//
// Turn-key goes on to the PROPOSAL below - the price and what is included -
// and then into the booking wizard that already knows how to write a job.
// DIY-assisted goes into the same wizard's plan path.
//
// Nothing is written here. The wizard owns every answer (selections, the
// survey, the photographs) so they survive its other steps and upload only
// once the job exists, because a storage path starts with the job's id.
//
// THE PAGE IS THE DATA'S SHAPE, NOT A COPY OF IT. Every price-moving answer
// is a lever (the question, the options and the deltas come from the
// package), every appliance is a gas_appliance_kinds row, and the context
// shot is the package's 'spot' photo slot. The one thing this file decides is
// which lever goes on which step; a lever it does not know - one somebody adds
// in Admin tomorrow - is asked on step 3 rather than dropped.

export type Approach = "turnkey" | "diy";
export type Plate = { file: File; preview: string };
export type SurveyState = {
  step: 1 | 2 | 3;
  // Exact feet behind each banded lever: the band is what is priced, the feet
  // are what the contractor measures against.
  feet: Record<string, number>;
  kinds: string[];
  // "Are all appliances on this list?" - null until answered, which matters:
  // an unanswered list leaves the unticked kinds unknown, not absent.
  allListed: boolean | null;
  other: string;
  urls: Record<string, string>;
  approach: Approach | null;
};

const STEP_LEVERS: Record<1 | 3, string[]> = { 1: ["size", "transfer", "panel_run"], 3: ["gas", "gas_run"] };
const PLACED = new Set([...STEP_LEVERS[1], ...STEP_LEVERS[3]]);
const leversOn = (pkg: Package, step: 1 | 3) => {
  const known = STEP_LEVERS[step].map((k) => pkg.levers.find((l) => l.key === k)).filter((l): l is Lever => !!l);
  return step === 3 ? [...known, ...pkg.levers.filter((l) => !PLACED.has(l.key))] : known;
};
export const CONTEXT_SLOT = "spot";
const OTHER = "other";

export const surveyApplies = (pkg: Package) => !!pkg.needs_gas_survey && (pkg.gas_kinds?.length ?? 0) > 0;

// ---- a distance lever as a slider -----------------------------------------
const isBanded = (l: Lever) => !!l.unit && l.options.some((o) => o.upto != null);
const STEP_FT = 5;
function bands(l: Lever) {
  const bounded = l.options.filter((o) => o.upto != null).map((o) => o.upto!);
  const top = Math.max(...bounded);
  return { top, max: l.options.some((o) => o.upto == null) ? top + STEP_FT : top };
}
// The option whose band holds this many feet: the first that reaches it, else
// the open-ended one.
export const optionFor = (l: Lever, ft: number) =>
  l.options.find((o) => o.upto != null && ft <= o.upto) ?? l.options.find((o) => o.upto == null) ?? l.options[l.options.length - 1]!;
// Where the slider starts for a selection: 10 ft inside the default band (the
// mock-up's starting point), otherwise the top of the chosen band.
function feetFor(l: Lever, key: string | undefined) {
  const o = l.options.find((x) => x.key === key) ?? l.options.find((x) => x.is_default);
  if (!o) return STEP_FT;
  if (o.is_default && o.upto != null) return Math.min(10, o.upto);
  return o.upto ?? bands(l).max;
}
const ftLabel = (l: Lever, ft: number) => {
  const { top } = bands(l);
  return ft > top ? `${top}+ ${l.unit}` : `${ft} ${l.unit}`;
};

export function initialSurvey(pkg: Package, sel: Selections): SurveyState {
  const feet: Record<string, number> = {};
  for (const l of pkg.levers) if (isBanded(l)) feet[l.key] = feetFor(l, sel[l.key]);
  return { step: 1, feet, kinds: [], allListed: null, other: "", urls: {}, approach: null };
}

// What homeowner_gas_survey_save takes.
export function surveyPayload(pkg: Package, s: SurveyState) {
  const ft = (key: string) => (s.feet[key] != null ? String(s.feet[key]) : null);
  return {
    approach: s.approach,
    panel_ft: ft("panel_run"),
    gas_ft: ft("gas_run"),
    all_listed: s.allListed,
    other: s.allListed === false ? s.other.trim() || null : null,
    appliances: s.kinds.filter((k) => k !== OTHER).map((k) => ({ kind: k, product_url: cleanUrl(s.urls[k]) })),
  };
}
// A pasted link, made https when it came without a scheme. Anything that is
// not a web address is dropped rather than sent to be refused.
export function cleanUrl(raw: string | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t.replace(/^http:\/\//i, "https://") : `https://${t}`;
  try { const u = new URL(withScheme); return u.hostname.includes(".") ? u.toString() : null; } catch { return null; }
}

// ---- the three steps -------------------------------------------------------
export function PowerSurvey({
  pkg, sel, onSel, value, onChange, plates, onPlates, context, onContext, back, onDone,
}: {
  pkg: Package; sel: Selections; onSel: (s: Selections) => void;
  value: SurveyState; onChange: (s: SurveyState) => void;
  plates: Record<string, Plate[]>; onPlates: (kind: string, files: Plate[]) => void;
  context: Plate | null; onContext: (file: File | null) => void;
  back: string; onDone: (a: Approach) => void;
}) {
  const s = value;
  const set = (patch: Partial<SurveyState>) => onChange({ ...s, ...patch });
  const go = (step: SurveyState["step"]) => { set({ step }); if (typeof window !== "undefined") window.scrollTo(0, 0); };
  const kinds = (pkg.gas_kinds ?? []).filter((k) => k.key !== OTHER);
  const chosen = kinds.filter((k) => s.kinds.includes(k.key));
  const slot = pkg.photos.find((p) => p.key === CONTEXT_SLOT) ?? null;
  const price = priceFor(pkg, sel);

  const lever = (l: Lever) => isBanded(l)
    ? <DistanceLever key={l.key} lever={l} ft={s.feet[l.key] ?? feetFor(l, sel[l.key])}
        onFt={(ft) => { set({ feet: { ...s.feet, [l.key]: ft } }); onSel({ ...sel, [l.key]: optionFor(l, ft).key }); }} />
    : <ChoiceLever key={l.key} lever={l} value={sel[l.key]} onPick={(k) => onSel({ ...sel, [l.key]: k })} />;

  if (s.step === 1) {
    const [first, ...rest] = leversOn(pkg, 1);
    return (
      <Screen>
        <AppBar back={back} title={pkg.tile_title} sub="Scope & sizing" />
        <div className="body">
          <SurveyProgress step={1} />
          {first && lever(first)}
          {rest.map(lever)}

          <section className="survey-q">
            <h2>Which appliances in the house run on gas?</h2>
            <p className="small text-muted">The generator shares the gas meter with them. Tick every one — it decides whether the meter is big enough.</p>
            <div className="stack" style={{ gap: 6 }}>
              {kinds.map((k) => (
                <label className="check-row" key={k.key}>
                  <input type="checkbox" checked={s.kinds.includes(k.key)}
                    onChange={(e) => set({ kinds: e.target.checked ? [...s.kinds, k.key] : s.kinds.filter((x) => x !== k.key) })} />
                  <span><span className="t">{k.label}</span></span>
                </label>
              ))}
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <span className="field-label">Is that everything on gas?</span>
              <div className="seg" role="radiogroup" aria-label="Is that everything on gas?">
                <label className="seg-opt"><input type="radio" name="all-listed" checked={s.allListed === true} onChange={() => set({ allListed: true })} />Yes, that&apos;s all</label>
                <label className="seg-opt"><input type="radio" name="all-listed" checked={s.allListed === false} onChange={() => set({ allListed: false })} />No, there&apos;s more</label>
              </div>
            </div>
            {s.allListed === false && (
              <label className="field">
                <span className="field-label">What else runs on gas?</span>
                <input className="input" placeholder="A garage heater, a gas light…" value={s.other} onChange={(e) => set({ other: e.target.value })} />
              </label>
            )}
          </section>

          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block" onClick={() => go(chosen.length > 0 ? 2 : 3)}>
              {chosen.length > 0 ? `Continue · ${chosen.length} appliance${chosen.length === 1 ? "" : "s"}` : "Continue"}
            </button>
            {chosen.length === 0 && <p className="tiny text-muted center" style={{ margin: 0 }}>None ticked — step 2 is skipped. The plumber asks on site.</p>}
          </div>
        </div>
      </Screen>
    );
  }

  if (s.step === 2) {
    return (
      <Screen>
        <AppBar back={() => go(1)} title={pkg.tile_title} sub="Appliance details" />
        <div className="body">
          <SurveyProgress step={2} />
          <p className="lead" style={{ margin: 0 }}>A photo of each spec plate — or a link to the model — lets the plumber draw the gas diagram without a visit. Skip any you can&apos;t reach.</p>
          {chosen.map((k, i) => (
            <ApplianceCard key={k.key} n={i + 1} kind={k} plates={plates[k.key] ?? []} onPlates={(f) => onPlates(k.key, f)}
              url={s.urls[k.key] ?? ""} onUrl={(u) => set({ urls: { ...s.urls, [k.key]: u } })} />
          ))}
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block" onClick={() => go(3)}>Done with details</button>
            <p className="tiny text-muted center" style={{ margin: 0 }}>Photos upload when you book. Only the contractor on your job sees them.</p>
          </div>
        </div>
      </Screen>
    );
  }

  const work = pkg.items.filter((it) => it.kind !== "hardware" && it.kind !== "assurance").length;
  return (
    <Screen>
      <AppBar back={() => go(chosen.length > 0 ? 2 : 1)} title={pkg.tile_title} sub="Installation & project type" />
      <div className="body">
        <SurveyProgress step={3} />
        {leversOn(pkg, 3).map(lever)}

        {slot && (
          <section className="survey-q">
            <h2>{slot.label}</h2>
            {slot.hint && <p className="small text-muted">{slot.hint}</p>}
            <ContextShot shot={context} onPick={onContext} label={slot.label} />
          </section>
        )}

        <section className="survey-q">
          <h2>How do you want it done?</h2>
          <div className="approach">
            <label className="approach-card">
              <input type="radio" name="approach" checked={s.approach === "turnkey"} onChange={() => set({ approach: "turnkey" })} />
              <span className="kicker">Turn-key installation</span>
              <span className="small">A licensed contractor does all {work} steps, from the permits to the town&apos;s inspection, at one community price.</span>
              {price != null && <span className="mono approach-price">{dollars(price)}</span>}
            </label>
            <label className="approach-card">
              <input type="radio" name="approach" checked={s.approach === "diy"} onChange={() => set({ approach: "diy" })} />
              <span className="kicker">DIY-assisted</span>
              <span className="small">You manage the permits and the pad. We point you to the generator to buy, and your survey stays on the project for engineering questions.</span>
              <span className="mono approach-price">Parts + your time</span>
            </label>
          </div>
        </section>

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block" disabled={!s.approach} onClick={() => s.approach && onDone(s.approach)}>
            {s.approach === "diy" ? "Finish & add to my DIY projects" : s.approach === "turnkey" ? "Finish & see my proposal" : "Pick one to finish"}
          </button>
          <p className="tiny text-muted center" style={{ margin: 0 }}>Nothing is sent or charged yet. You can switch later.</p>
        </div>
      </div>
    </Screen>
  );
}

// ---- turn-key: the proposal -------------------------------------------------
export function Proposal({ pkg, sel, survey, onBack, onEdit, onAccept }: {
  pkg: Package; sel: Selections; survey: SurveyState; onBack: () => void; onEdit: () => void; onAccept: () => void;
}) {
  const price = priceFor(pkg, sel);
  const deltas = deltaNotes(pkg, sel);
  const kinds = (pkg.gas_kinds ?? []).filter((k) => survey.kinds.includes(k.key));
  const lo = kinds.reduce((t, k) => t + (k.typical_low ?? 0), 0);
  const hi = kinds.reduce((t, k) => t + (k.typical_high ?? 0), 0);
  const payments = pkg.milestones.filter((m) => m.kind === "payment" && m.percent_of_contract);
  const btu = (n: number) => `${Math.round(n / 1000).toLocaleString()}k`;

  return (
    <Screen>
      <AppBar back={onBack} title={pkg.tile_title} sub="Your proposal" />
      <div className="body">
        <StepKicker>Turn-key · Your proposal</StepKicker>
        <div className="hero">
          <h1>Your {pkg.tile_title.toLowerCase()}, done for you.</h1>
          <p className="lead">Priced from your answers. Book it and the price is held; contractors accept at it or pass — nobody counter-offers.</p>
        </div>

        <Card pad={false}>
          <PriceBlock cents={price} was={deltas.length ? pkg.base_price_cents : null} config={configLabel(pkg, sel)} delta={deltas} kicker="Community price · turn-key" />
        </Card>

        <Card pad>
          <h6 style={{ marginBottom: 2 }}>Your setup</h6>
          <div className="kv-rows">
            {pkg.levers.map((l) => {
              const o = l.options.find((x) => x.key === sel[l.key]);
              if (!o) return null;
              const ft = isBanded(l) ? survey.feet[l.key] : undefined;
              return (
                <div key={l.key}>
                  <span className="k">{l.label}</span>
                  <span style={{ textAlign: "right" }}>
                    {ft != null ? ftLabel(l, ft) : o.label}
                    {o.price_delta_cents !== 0 && <span className="text-muted"> · {dollars(o.price_delta_cents, { sign: true })}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {(kinds.length > 0 || survey.allListed != null) && (
          <Card pad>
            <h6 style={{ marginBottom: 2 }}>Gas already in the house</h6>
            {kinds.length > 0 ? (
              <>
                <p className="small" style={{ margin: "2px 0 6px" }}>{kinds.map((k) => k.label).join(", ")}{survey.allListed === false && survey.other.trim() ? `, and ${survey.other.trim()}` : ""}.</p>
                {hi > 0 && <p className="small text-muted" style={{ margin: 0 }}>Appliances like these typically draw {btu(lo)}–{btu(hi)} BTU/h together. The plumber reads the real numbers off the plates and checks the meter carries them and the generator.</p>}
              </>
            ) : (
              <p className="small text-muted" style={{ margin: 0 }}>{survey.allListed === false && survey.other.trim() ? `${survey.other.trim()}. ` : "Nothing else on gas. "}The plumber checks the meter against it.</p>
            )}
          </Card>
        )}

        <Card pad>
          <h6 style={{ marginBottom: 6 }}>What&apos;s included</h6>
          <ul className="scope">
            {pkg.items.filter((it) => !isHardware(it)).map((it, i) => (
              <li key={i}>
                <span className="ic"><CheckIcon size={18} /></span>
                <span>{it.label}{it.detail && <span className="detail"> — {it.detail}</span>}</span>
              </li>
            ))}
          </ul>
        </Card>

        {pkg.items.some(isHardware) && (
          <Card pad>
            <h6 style={{ marginBottom: 2 }}>What you buy</h6>
            <p className="small text-muted" style={{ margin: "0 0 6px" }}>Not in the price. Have it delivered to the house before the crew comes.</p>
            <ul className="scope">
              {pkg.items.filter(isHardware).map((it, i) => (
                <li key={i} style={{ flexWrap: "wrap" }}>
                  <span className="grow">
                    {it.label}{it.detail && <span className="detail"> — {it.detail}</span>}
                    {(it.links?.length ?? 0) > 0 && (
                      <span className="row" style={{ marginTop: 6, flexWrap: "wrap" }}>
                        {it.links!.map((l) => (
                          <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="btn btn-soft" style={{ minHeight: 34, fontSize: 12.5 }}>{l.label} ↗</a>
                        ))}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {payments.length > 0 && price != null && (
          <Card pad>
            <h6 style={{ marginBottom: 2 }}>How you pay</h6>
            <div className="kv-rows">
              <div><span className="k">Today</span><span>Nothing</span></div>
              {payments.map((m) => (
                <div key={m.key}>
                  <span className="k">{m.name} · {m.percent_of_contract}%</span>
                  <span className="mono">{dollars(Math.round((price * m.percent_of_contract!) / 100))}</span>
                </div>
              ))}
            </div>
            <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>Paid to your contractor, not to us.</p>
          </Card>
        )}

        {survey.kinds.length > 0 && survey.allListed == null && (
          <Notice title="One thing unanswered">You didn&apos;t say whether that is every gas appliance. The plumber will ask — or <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0 }} onClick={onEdit}>answer it now</button>.</Notice>
        )}

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block" onClick={onAccept}>Accept · book at {dollars(price)}</button>
          <button type="button" className="btn btn-ghost btn-block" onClick={onEdit}>Change my answers</button>
          <p className="tiny text-muted center" style={{ margin: 0 }}>Next: which home, the house, the photos. Nothing is charged today.</p>
        </div>
      </div>
    </Screen>
  );
}

// ---- pieces ------------------------------------------------------------------
function SurveyProgress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <div className="survey-progress" aria-label={`Step ${step} of 3`}>
      <div className="bars">{[1, 2, 3].map((n) => <span key={n} className={n <= step ? "on" : ""} />)}</div>
      <div className="small text-muted"><strong>Step {step} of 3</strong> · about a minute</div>
    </div>
  );
}

function ChoiceLever({ lever, value, onPick }: { lever: Lever; value: string | undefined; onPick: (k: string) => void }) {
  return (
    <section className="survey-q">
      <h2>{lever.question ?? lever.label}</h2>
      {lever.control === "seg" ? (
        <div className="seg" role="radiogroup" aria-label={lever.label}>
          {lever.options.map((o) => (
            <label className="seg-opt" key={o.key}>
              <input type="radio" name={`sv-${lever.key}`} checked={value === o.key} onChange={() => onPick(o.key)} />
              {o.label}
            </label>
          ))}
        </div>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          {lever.options.map((o) => (
            <label className="radio" key={o.key}>
              <input type="radio" name={`sv-${lever.key}`} checked={value === o.key} onChange={() => onPick(o.key)} />
              <span className="dot" />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      )}
      <Delta lever={lever} value={value} />
    </section>
  );
}

function DistanceLever({ lever, ft, onFt }: { lever: Lever; ft: number; onFt: (ft: number) => void }) {
  const { top, max } = bands(lever);
  const stops: number[] = [];
  for (let v = STEP_FT; v <= max; v += STEP_FT) stops.push(v);
  const o = optionFor(lever, ft);
  return (
    <section className="survey-q">
      <h2>{lever.question ?? lever.label}</h2>
      <div className="distance">
        <div className="distance-now"><span className="mono">{ftLabel(lever, ft)}</span><span className="small text-muted">{o.label}</span></div>
        <input type="range" min={STEP_FT} max={max} step={STEP_FT} value={Math.min(ft, max)} aria-label={lever.label}
          aria-valuetext={ftLabel(lever, ft)} onChange={(e) => onFt(Number(e.target.value))} />
        <div className="distance-ticks" aria-hidden="true">
          {stops.filter((v) => v === STEP_FT || v % 10 === 0 || v === max).map((v) => <span key={v}>{v > top ? `${top}+` : v}</span>)}
        </div>
      </div>
      <Delta lever={lever} value={o.key} />
    </section>
  );
}

function Delta({ lever, value }: { lever: Lever; value: string | undefined }) {
  const o = lever.options.find((x) => x.key === value);
  if (!o) return null;
  return (
    <p className="tiny text-muted" style={{ margin: "4px 0 0" }}>
      {o.price_delta_cents === 0 ? (o.is_default ? "Included in the price." : "No change to the price.") : `${dollars(o.price_delta_cents, { sign: true })} to the price.`}
    </p>
  );
}

function ApplianceCard({ n, kind, plates, onPlates, url, onUrl }: {
  n: number; kind: GasKind; plates: Plate[]; onPlates: (p: Plate[]) => void; url: string; onUrl: (u: string) => void;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onPlates([...plates, ...Array.from(list).map((file) => ({ file, preview: URL.createObjectURL(file) }))]);
  };
  const remove = (i: number) => { URL.revokeObjectURL(plates[i]!.preview); onPlates(plates.filter((_, j) => j !== i)); };
  const bad = url.trim() !== "" && cleanUrl(url) == null;
  return (
    <details className="slot appliance" open>
      <summary className="head"><span className="n">{n} · {kind.label}</span>{(plates.length > 0 || (url.trim() && !bad)) && <span className="tag tag-accent">Added</span>}</summary>
      {plates.length > 0 && (
        <div className="plates">
          {plates.map((p, i) => (
            <span className="plate" key={p.preview}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.preview} alt={`${kind.label} photo ${i + 1}`} />
              <button type="button" aria-label="Remove photo" onClick={() => remove(i)}>×</button>
            </span>
          ))}
        </div>
      )}
      <button type="button" className="btn btn-primary btn-block" onClick={() => cam.current?.click()}>
        {plates.length ? "Add another photo" : "Photograph the spec plate"}
      </button>
      <label className="field" style={{ margin: 0 }}>
        <span className="field-label">Or paste a link to the model</span>
        <input className={`input ${bad ? "invalid" : ""}`} inputMode="url" placeholder="homedepot.com/…" value={url} onChange={(e) => onUrl(e.target.value)} />
        {bad && <span className="hint" style={{ color: "var(--color-danger)" }}>That doesn&apos;t look like a web address.</span>}
      </label>
      <button type="button" className="btn btn-soft btn-block" onClick={() => lib.current?.click()}>Optional: more photos from the library</button>
      {kind.hint && <p className="tiny text-muted" style={{ margin: 0 }}>{kind.hint}</p>}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" multiple hidden onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
    </details>
  );
}

function ContextShot({ shot, onPick, label }: { shot: Plate | null; onPick: (f: File | null) => void; label: string }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  return (
    <div className="context-shot">
      {shot ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shot.preview} alt={label} />
      ) : (
        <div className="frame" aria-hidden="true"><span>Meter + spot, one frame</span></div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-secondary" style={{ flex: 1 }} onClick={() => cam.current?.click()}>{shot ? "Retake" : "Camera"}</button>
        <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => lib.current?.click()}>Library</button>
        {shot && <button type="button" className="btn btn-ghost" onClick={() => onPick(null)}>Remove</button>}
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { onPick(e.target.files?.[0] ?? null); e.target.value = ""; }} />
    </div>
  );
}
