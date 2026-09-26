"use client";

import { useRef } from "react";
import { marked, type Lever, type LeverOption, type Package, type PhotoReq, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { Illustration } from "@shared/Illustrations";
import { AppBar, Card, Screen } from "@shared/ui";
import { ChoiceLever, ProposalView, WalkProgress } from "./SurveyParts";

// THE PHOTOS, ONE CAMERA SCREEN AT A TIME (Shahar, 2026-09-24, a four-phone
// mock-up of the epoxy garage floor; migration 236).
//
//   1      The setup           the size - as a car count or a width x length
//                              that picks the car count - and every other lever
//   2..n   One screen a step   a viewfinder with the slot's guide over it
//                              ("Step back 15 ft. Capture the entire
//                              opening."); slots sharing a step sit side by side
//   Finish -> the instant quote: the proposal, then the ordinary booking - or
//             DIY, which saves it as a plan.
//
// Nothing is written here. The wizard owns the selections and the photos, so
// they survive its other steps and upload only once the job exists (a storage
// path starts with the job's id). Nothing here blocks either: a photo not
// taken becomes the inbox request after booking, as it always has.
//
// THE PAGE IS THE DATA'S SHAPE. The screens are the package's photo slots
// grouped by step, the words on them are the slots' label, guide and hint, the
// questions are its levers. Any package with guided_photos walks this way.

export type WalkState = { step: number; width: string; length: string };
type Taken = { preview: string } | undefined;

export const initialWalk = (): WalkState => ({ step: 0, width: "", length: "" });

// The photo screens, in step order; slots sharing a step share a screen.
export function photoSteps(pkg: Package): PhotoReq[][] {
  const by = new Map<number, PhotoReq[]>();
  for (const p of pkg.photos) if (p.step != null) by.set(p.step, [...(by.get(p.step) ?? []), p]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g);
}

// The size lever: an area measured in a unit, its options bands reaching up to
// each upto (migration 235's unit / upto, in sq ft here).
const AREA_UNITS: Record<string, string> = { sqft: "sq ft" };
const sizeLever = (pkg: Package) => pkg.levers.find((l) => !!l.unit && AREA_UNITS[l.unit] && l.options.some((o) => o.upto != null)) ?? null;
const bandFor = (l: Lever, area: number) =>
  l.options.find((o) => o.upto != null && area <= o.upto) ?? l.options.find((o) => o.upto == null) ?? l.options[l.options.length - 1]!;
const bandLine = (l: Lever, o: LeverOption) => {
  const unit = AREA_UNITS[l.unit ?? ""] ?? l.unit;
  if (o.upto != null) return `up to ${o.upto.toLocaleString()} ${unit}`;
  const below = Math.max(0, ...l.options.filter((x) => x.upto != null).map((x) => x.upto!));
  return `over ${below.toLocaleString()} ${unit}`;
};
const feet = (v: string) => (/^\d{1,3}$/.test(v) && Number(v) >= 4 && Number(v) <= 200 ? Number(v) : null);
export const measuredArea = (s: WalkState) => { const w = feet(s.width), l = feet(s.length); return w && l ? w * l : null; };

// What homeowner_booking_survey_save takes.
export const walkPayload = (s: WalkState) => ({ width_ft: feet(s.width)?.toString() ?? null, length_ft: feet(s.length)?.toString() ?? null });

// A screen's name: the slot's label, or for a pair "Exterior, 45° to the left"
// and "Exterior, 45° to the right" -> "Angled exterior views", each tile then
// carrying what is left of its own label.
function prefixOf(group: PhotoReq[]) {
  const heads = group.map((p) => p.label.split(", ")[0]!);
  return group.length > 1 && heads.every((h) => h === heads[0]) && group.every((p) => p.label.includes(", ")) ? heads[0]! : null;
}
const groupTitle = (group: PhotoReq[]) => {
  if (group.length === 1) return group[0]!.label;
  const pre = prefixOf(group);
  return pre ? `Angled ${pre.toLowerCase()} views` : `${group.length} photos`;
};
const tileLabel = (p: PhotoReq, pre: string | null) => {
  const rest = pre ? p.label.slice(pre.length + 2) : p.label;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
};
// "Step back 15 ft. Capture the entire opening." -> the headline and the line.
const splitGuide = (g: string) => { const m = g.match(/^(.+?[.!?])\s+(.+)$/); return m ? [m[1]!, m[2]!] as const : [g, null] as const; };

export function GuidedSurvey({ pkg, sel, onSel, value, onChange, shots, onShot, back, onDone }: {
  pkg: Package; sel: Selections; onSel: (s: Selections) => void;
  value: WalkState; onChange: (s: WalkState) => void;
  shots: Record<string, Taken>; onShot: (key: string, file: File | null) => void;
  back: string; onDone: () => void;
}) {
  const s = value;
  const set = (patch: Partial<WalkState>) => onChange({ ...s, ...patch });
  const groups = photoSteps(pkg);
  const total = groups.length + 1;
  const go = (step: number) => { set({ step }); if (typeof window !== "undefined") window.scrollTo(0, 0); };
  const size = sizeLever(pkg);

  if (s.step === 0) {
    const area = measuredArea(s);
    const typing = s.width !== "" || s.length !== "";
    const onDims = (width: string, length: string) => {
      const next = { ...s, width, length };
      onChange(next);
      const a = measuredArea(next);
      if (size && a) onSel({ ...sel, [size.key]: bandFor(size, a).key });
    };
    return (
      <Screen>
        <AppBar back={back} title={pkg.tile_title} sub="Your setup" />
        <div className="body">
          <div className="walk-head">
            <h1>Step 1: {size ? size.label : "Your setup"}</h1>
            <WalkProgress step={1} of={total} />
          </div>

          {size && (
            <section className="survey-q">
              <h2>{size.question ?? size.label}</h2>
              <div className="size-cards" role="radiogroup" aria-label={size.label}>
                {size.options.map((o) => (
                  <label className="size-card" key={o.key}>
                    <input type="radio" name={`walk-${size.key}`} checked={sel[size.key] === o.key}
                      onChange={() => { onSel({ ...sel, [size.key]: o.key }); set({ width: "", length: "" }); }} />
                    <span className="big">{o.chip ?? o.label}</span>
                    <span className="tiny text-muted">{bandLine(size, o)}</span>
                    <span className="tiny">{o.price_delta_cents === 0 ? "Base price" : dollars(marked(pkg, o.price_delta_cents), { sign: true })}</span>
                  </label>
                ))}
              </div>
              <div className="field" style={{ marginTop: 6 }}>
                <span className="field-label">Or measure it <span className="text-muted">(width × length)</span></span>
                <div className="dims">
                  <input className="input" inputMode="numeric" placeholder="Width" aria-label="Width in feet" value={s.width}
                    onChange={(e) => onDims(e.target.value.replace(/[^\d]/g, "").slice(0, 3), s.length)} />
                  <span aria-hidden="true">×</span>
                  <input className="input" inputMode="numeric" placeholder="Length" aria-label="Length in feet" value={s.length}
                    onChange={(e) => onDims(s.width, e.target.value.replace(/[^\d]/g, "").slice(0, 3))} />
                  <span className="small text-muted">ft</span>
                </div>
                {area ? (
                  <span className="hint">{area.toLocaleString()} {AREA_UNITS[size.unit!]} — priced as {(bandFor(size, area).chip ?? bandFor(size, area).label)}. The crew measures on the day.</span>
                ) : typing ? (
                  <span className="hint">Both sides, in feet, between 4 and 200.</span>
                ) : null}
              </div>
            </section>
          )}

          {pkg.levers.filter((l) => l !== size).map((l) => (
            <ChoiceLever key={l.key} pkg={pkg} lever={l} value={sel[l.key]} short onPick={(k) => onSel({ ...sel, [l.key]: k })} />
          ))}

          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block" onClick={() => (groups.length ? go(1) : onDone())}>Continue</button>
            {groups.length > 0 && <p className="tiny text-muted center" style={{ margin: 0 }}>Next: {groups.length === 1 ? "one photo" : `${groups.length} quick photo steps`}. Not at home? You can skip them.</p>}
          </div>
        </div>
      </Screen>
    );
  }

  const i = Math.min(s.step, groups.length) - 1;
  const group = groups[i] ?? [];
  const last = i === groups.length - 1;
  const pre = prefixOf(group);
  const missing = group.filter((p) => !shots[p.key]).length;
  return (
    <Screen>
      <AppBar back={() => go(s.step - 1)} title={pkg.tile_title} sub="Your photos" />
      <div className="body">
        <div className="walk-head">
          <h1>Step {i + 2}: {groupTitle(group)}</h1>
          <WalkProgress step={i + 2} of={total} />
        </div>

        {group.length === 1 ? (
          <Viewfinder slot={group[0]!} shot={shots[group[0]!.key]} onShot={(f) => onShot(group[0]!.key, f)} art={pkg.illustration} />
        ) : (
          <div className="pair">
            {group.map((p, n) => (
              <PairTile key={p.key} n={n + 1} slot={p} label={tileLabel(p, pre)} shot={shots[p.key]} onShot={(f) => onShot(p.key, f)} />
            ))}
          </div>
        )}

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block" onClick={() => (last ? onDone() : go(s.step + 1))}>
            {last ? "Finish & get my instant quote" : missing === 0 ? "Continue" : "Skip for now"}
          </button>
          <p className="tiny text-muted center" style={{ margin: 0 }}>
            {missing === 0
              ? "Photos upload when you book. Only the contractor on your job sees them."
              : `Not at the garage? We ask for ${missing === 1 ? "it" : "them"} again after you book — the price holds.`}
          </p>
        </div>
      </div>
    </Screen>
  );
}

// ---- turn-key: the instant quote ------------------------------------------------
export function GuidedProposal({ pkg, sel, walk, shots, onBack, onEdit, onAccept, onDiy }: {
  pkg: Package; sel: Selections; walk: WalkState; shots: Record<string, Taken>;
  onBack: () => void; onEdit: () => void; onAccept: () => void; onDiy: () => void;
}) {
  const size = sizeLever(pkg);
  const area = measuredArea(walk);
  const wanted = pkg.photos.filter((p) => p.step != null);
  const taken = wanted.filter((p) => shots[p.key]);
  return (
    <ProposalView pkg={pkg} sel={sel} onBack={onBack} onEdit={onEdit} onAccept={onAccept} onDiy={onDiy}
      setup={(l, o) => (l === size && area ? `${walk.width} × ${walk.length} ft · ${area.toLocaleString()} ${AREA_UNITS[l.unit!]} · ${o.chip ?? o.label}` : null)}>
      {wanted.length > 0 && (
        <Card pad>
          <h6 style={{ marginBottom: 2 }}>Your photos</h6>
          {taken.length > 0 && (
            <div className="plates" style={{ margin: "4px 0 6px" }}>
              {taken.map((p) => (
                <span className="plate" key={p.key}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={shots[p.key]!.preview} alt={p.label} />
                </span>
              ))}
            </div>
          )}
          <p className="small text-muted" style={{ margin: 0 }}>
            {taken.length === wanted.length
              ? "All of them. The crew confirms the price from these without a visit."
              : `${taken.length} of ${wanted.length}. We ask for the rest after you book; the crew confirms once they are in.`}
          </p>
        </Card>
      )}
    </ProposalView>
  );
}

// ---- pieces ------------------------------------------------------------------
function Viewfinder({ slot, shot, onShot, art }: { slot: PhotoReq; shot: Taken; onShot: (f: File | null) => void; art: string }) {
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [head, line] = splitGuide(slot.guide ?? slot.label);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={`viewfinder ${shot ? "taken" : ""}`}>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.preview} alt={slot.label} />
        ) : slot.example_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="example" src={slot.example_url} alt={`Example: ${slot.label}`} />
        ) : (
          <div className="vf-art" aria-hidden="true"><Illustration name={art} /></div>
        )}
        <span className="vf-corner tl" /><span className="vf-corner tr" /><span className="vf-corner bl" /><span className="vf-corner br" />
        <button type="button" className="vf-cam" aria-label="Open the camera" onClick={() => cam.current?.click()}><CameraIcon /></button>
        {!shot && <div className="vf-guide"><strong>{head}</strong>{line && <span>{line}</span>}</div>}
        <button type="button" className="vf-shoot" aria-label={shot ? "Retake the photo" : "Take or upload the photo"} onClick={() => pick.current?.click()}><UploadIcon /></button>
      </div>
      {shot ? (
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="small">Taken ✓ <span className="text-muted">— tap the button to retake</span></span>
          <button type="button" className="btn btn-ghost" onClick={() => onShot(null)}>Remove</button>
        </div>
      ) : (
        slot.hint && <p className="small text-muted" style={{ margin: 0 }}>{slot.hint}</p>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onShot(f); e.target.value = ""; }} />
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onShot(f); e.target.value = ""; }} />
    </div>
  );
}

function PairTile({ n, slot, label, shot, onShot }: { n: number; slot: PhotoReq; label: string; shot: Taken; onShot: (f: File | null) => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  const [head, line] = splitGuide(slot.guide ?? "");
  return (
    <div className="pair-slot">
      <button type="button" className={`pair-tile ${shot ? "taken" : ""}`} aria-label={shot ? `Retake: ${slot.label}` : `Add: ${slot.label}`} onClick={() => pick.current?.click()}>
        <span className="pair-n">{n}</span>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.preview} alt={slot.label} />
        ) : slot.example_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="example" src={slot.example_url} alt="" />
        ) : (
          <UploadIcon />
        )}
      </button>
      {/* The camera directly, as on the single viewfinder; the tile itself
          takes or uploads. A sibling, since a button cannot hold a button. */}
      <button type="button" className="vf-cam pair-cam" aria-label={`Open the camera: ${slot.label}`} onClick={() => cam.current?.click()}><CameraIcon /></button>
      <strong className="pair-label">{label}</strong>
      <span className="small text-muted">{slot.hint ?? [head, line].filter(Boolean).join(" ")}</span>
      {shot && <button type="button" className="btn btn-ghost" style={{ minHeight: 0, padding: 0, alignSelf: "flex-start" }} onClick={() => onShot(null)}>Remove</button>}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onShot(f); e.target.value = ""; }} />
      <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onShot(f); e.target.value = ""; }} />
    </div>
  );
}

const UploadIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M5 14v5h14v-5" />
  </svg>
);
const CameraIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" />
  </svg>
);
