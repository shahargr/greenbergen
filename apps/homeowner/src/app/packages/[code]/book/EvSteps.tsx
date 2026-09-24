"use client";

import { useEffect, useRef } from "react";
import { configLabel, type Package, type PhotoReq, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { AppBar, Notice, Screen } from "@shared/ui";
import {
  AMPS, DISTANCE_LEVER, FT_MAX, FT_MIN, FT_STEP, VEHICLES, bandFor, feetLabel, panelSlots, wallSlots,
  type EvAnswers,
} from "@/lib/ev";
import type { Shot } from "./BookingWizard";

// The three EV charger screens (lib/ev.ts says why they exist). They hold no
// state of their own: the wizard owns the answers, the selections and the
// photos, so the price, the Google round trip and the upload after booking
// all work exactly as they do for every other package.

export type Way = "turnkey" | "diy";

type Common = {
  pkg: Package; sel: Selections; price: number | null;
  ev: EvAnswers; setEv: (a: EvAnswers) => void;
  back: () => void; next: () => void;
};

export function StepBar({ at }: { at: 1 | 2 | 3 }) {
  return (
    <div className="stepbar" aria-label={`Step ${at} of 3`}>
      <div className="step-kicker center">Step {at} of 3</div>
      <ol>
        {[1, 2, 3].map((n) => (
          <li key={n} className={n <= at ? "on" : ""} aria-current={n === at ? "step" : undefined}>
            <span className="bar" />
            <span className="lbl">Step {n}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---- 1 · your charging needs & location ------------------------------------
export function EvNeeds({ pkg, sel, setSel, price, ev, setEv, back, next }: Common & { setSel: (s: Selections) => void }) {
  const distance = pkg.levers.find((l) => l.key === DISTANCE_LEVER)!;
  const band = distance.options.find((o) => o.key === sel[DISTANCE_LEVER]) ?? distance.options.find((o) => o.is_default)!;
  const others = pkg.levers.filter((l) => l.key !== DISTANCE_LEVER);
  const amps = AMPS.find((a) => a.key === ev.amps)!;
  const pct = ((ev.feet - FT_MIN) / (FT_MAX - FT_MIN)) * 100;
  const setFeet = (ft: number) => {
    setEv({ ...ev, feet: ft });
    const key = bandFor(ft);
    if (sel[DISTANCE_LEVER] !== key) setSel({ ...sel, [DISTANCE_LEVER]: key });
  };

  return (
    <Screen>
      <AppBar back={back} />
      <form className="body" onSubmit={(e) => { e.preventDefault(); next(); }} noValidate>
        <StepBar at={1} />
        <div className="hero"><h1>Your charging needs &amp; location</h1></div>

        <div className="seg" role="radiogroup" aria-label="Where the charger goes">
          {([["garage", "Inside garage"], ["outside", "Outside / driveway"]] as const).map(([k, l]) => (
            <label className="seg-opt" key={k}>
              <input type="radio" name="ev-loc" checked={ev.location === k} onChange={() => setEv({ ...ev, location: k })} />
              {l}
            </label>
          ))}
        </div>

        <label className="field">
          <span className="field-label">Vehicle make / model</span>
          <select className="input" value={ev.vehicle} onChange={(e) => setEv({ ...ev, vehicle: e.target.value })}>
            <option value="">Choose your car</option>
            {VEHICLES.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>

        <div className="field">
          <span className="field-label">Distance to the electrical panel</span>
          <div className="range" style={{ ["--pct" as string]: `${pct}%` }}>
            <output className="bubble" htmlFor="ev-ft">{feetLabel(ev.feet)}</output>
            <input id="ev-ft" type="range" min={FT_MIN} max={FT_MAX} step={FT_STEP} value={ev.feet}
              aria-valuetext={feetLabel(ev.feet)} onChange={(e) => setFeet(Number(e.target.value))} />
            <div className="ends"><span>{FT_MIN} ft</span><span>{FT_MAX}+ ft</span></div>
          </div>
          <p className="hint">
            The way the wire would run, not a straight line. {band.label}
            {band.price_delta_cents ? ` · ${dollars(band.price_delta_cents, { sign: true })}` : " · included"}
          </p>
        </div>

        <div className="field">
          <span className="field-label">Charging power level</span>
          <div className="amp-chips" role="radiogroup" aria-label="Charging power level">
            {AMPS.map((a) => (
              <label className="amp-chip" key={a.key}>
                <input type="radio" name="ev-amps" checked={ev.amps === a.key} onChange={() => setEv({ ...ev, amps: a.key })} />
                {a.label}
              </label>
            ))}
          </div>
          <p className="hint">{amps.hint}</p>
        </div>

        {/* The other priced questions, as the package page asks them. */}
        {others.map((lever) => (
          <div className="field" key={lever.key}>
            <span className="field-label">{lever.question ?? lever.label}</span>
            <div className="seg" role="radiogroup" aria-label={lever.label}>
              {lever.options.map((o) => (
                <label className="seg-opt" key={o.key}>
                  <input type="radio" name={`lv-${lever.key}`} checked={sel[lever.key] === o.key} onChange={() => setSel({ ...sel, [lever.key]: o.key })} />
                  {o.chip ?? o.label}
                </label>
              ))}
            </div>
          </div>
        ))}

        <div className="estimate">
          <span className="grow" style={{ minWidth: 0 }}>
            <span className="kicker">Your estimate</span>
            <span className="c">{configLabel(pkg, sel)}</span>
          </span>
          <span className="n mono">{dollars(price)}</span>
        </div>

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block">Continue to Step 2</button>
        </div>
      </form>
    </Screen>
  );
}

// ---- 2 · electrical panel details ------------------------------------------
export function EvPanel({ pkg, ev, setEv, back, next, shots, onPick }: Common & { shots: Record<string, Shot | undefined>; onPick: (key: string, f: File | null | undefined) => void }) {
  const slots = panelSlots(pkg);
  const taken = slots.filter((s) => shots[s.key]).length;
  return (
    <Screen>
      <AppBar back={back} />
      <div className="body">
        <StepBar at={2} />
        <div className="hero">
          <h1>Electrical panel details</h1>
          <p className="lead">The electrician reads the amperage and the free breaker space off these, so the price holds without a visit.</p>
        </div>
        {slots.map((s) => <ShotTile key={s.key} req={s} shot={shots[s.key]} onPick={(f) => onPick(s.key, f)} />)}
        <label className="switch-row">
          <span className="grow">Is there a subpanel?</span>
          <span className="small text-muted">{ev.subpanel ? "Yes" : "No"}</span>
          <input type="checkbox" role="switch" className="switch" checked={ev.subpanel} onChange={(e) => setEv({ ...ev, subpanel: e.target.checked })} />
        </label>
        {ev.subpanel && (
          <label className="field">
            <span className="field-label">Where is it? <span className="text-muted">(optional)</span></span>
            <input className="input" placeholder="In the garage, by the door" value={ev.subpanel_where} onChange={(e) => setEv({ ...ev, subpanel_where: e.target.value })} />
            <p className="hint">A subpanel near the spot can shorten the run. The electrician decides which one feeds the charger.</p>
          </label>
        )}
        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block" onClick={next}>Continue to Step 3</button>
          <p className="tiny text-muted center" style={{ margin: 0 }}>
            {taken === 0 ? "Not at home? Continue. We ask for them after you book, and the price does not move." : taken < slots.length ? `${slots.length - taken} still to come. We ask after you book.` : "That's the panel."}
          </p>
        </div>
      </div>
    </Screen>
  );
}

// ---- 3 · target wall & project type ----------------------------------------
export function EvWall({ pkg, sel, price, back, next, shots, onPick, way, setWay, note, setNote, busy, err, restored }: Common & {
  shots: Record<string, Shot | undefined>; onPick: (key: string, f: File | null | undefined) => void;
  way: Way; setWay: (w: Way) => void; note: string; setNote: (s: string) => void;
  busy: string; err: string; restored: boolean;
}) {
  const turnkeyLines = pkg.items.filter((i) => (i.kind ?? "work") === "work").slice(0, 3).map((i) => i.label);
  const label = way === "diy" ? "Continue as DIY" : pkg.instant_book ? `Finish booking at ${dollars(price)}` : `Request at ${dollars(price)}`;
  return (
    <Screen>
      <AppBar back={back} />
      <div className="body">
        <StepBar at={3} />
        <div className="hero"><h1>Target wall &amp; project type</h1></div>
        {wallSlots(pkg).map((s) => <ShotTile key={s.key} req={s} shot={shots[s.key]} onPick={(f) => onPick(s.key, f)} big />)}

        <div className="ways" role="radiogroup" aria-label="How do you want it done?">
          <label className="way">
            <input type="radio" name="ev-way" checked={way === "turnkey"} onChange={() => setWay("turnkey")} />
            <BoltIcon />
            <span className="t">Complete turn-key installation</span>
            <ul>
              {turnkeyLines.map((l) => <li key={l}>{l}</li>)}
              <li>Insured, with a workmanship warranty</li>
            </ul>
            <span className="p mono">{dollars(price)}</span>
          </label>
          <label className="way">
            <input type="radio" name="ev-way" checked={way === "diy"} onChange={() => setWay("diy")} />
            <ToolsIcon />
            <span className="t">DIY with our checklist</span>
            <ul>
              <li>Every step in order</li>
              <li>Which steps need a licensed hand</li>
              <li>Nothing sent to contractors</li>
            </ul>
            <span className="p">Parts + your time</span>
          </label>
        </div>

        {way === "turnkey" && (
          <label className="field">
            <span className="field-label">Anything the electrician should know? <span className="text-muted">(optional)</span></span>
            <textarea className="input" rows={2} placeholder="Gate code, a dog, best time to come…" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        )}
        {restored && !busy && <Notice title="You're signed in.">Everything you chose is still here. Photos are asked for again after you book; the price is the same.</Notice>}
        {err && <Notice kind="error" title="That didn't go through.">{err}</Notice>}
        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className={`btn btn-primary btn-block ${busy ? "busy" : ""}`} disabled={!!busy} onClick={next}>
            {busy ? <><span className="spin" /> {busy}</> : label}
          </button>
          {!busy && (
            <p className="tiny text-muted center" style={{ margin: 0 }}>
              {way === "diy"
                ? `Nothing charged, nothing sent. ${dollars(price)} stays on it as your reference · ${configLabel(pkg, sel)}.`
                : pkg.requires_permit
                  ? `Nothing today. ${pkg.permit_deposit_pct}% at the permit meeting, to the electrician.`
                  : "Nothing today. You pay the electrician when it's done."}
            </p>
          )}
        </div>
      </div>
    </Screen>
  );
}

// A photo slot drawn as the thing to tap: a dashed frame with a camera in
// it, then the photo itself once taken. The library is one link below.
function ShotTile({ req, shot, onPick, big }: { req: PhotoReq; shot?: Shot; onPick: (f: File | null | undefined) => void; big?: boolean }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.preview); }, [shot]);
  return (
    <div className={`shot-tile ${big ? "big" : ""} ${shot ? "taken" : ""} ${shot?.state === "failed" ? "failed" : ""}`}>
      <button type="button" className="frame" onClick={() => cam.current?.click()} aria-label={shot ? `Retake: ${req.label}` : `Take a photo: ${req.label}`}>
        {shot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shot.preview} alt={req.label} />
        ) : (
          <>
            <CameraIcon />
            <span className="t">{req.label}</span>
            {req.hint && <span className="h">{req.hint}</span>}
          </>
        )}
      </button>
      <div className="foot small">
        {shot
          ? <><span className="text-muted grow">{req.label} · {shot.state === "failed" ? "upload failed, still on your phone" : "added"}</span><button type="button" className="btn btn-ghost" onClick={() => cam.current?.click()}>Retake</button></>
          : <button type="button" className="btn btn-ghost" onClick={() => lib.current?.click()}>Choose from library</button>}
      </div>
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

const CameraIcon = () => (
  <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
);
const BoltIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z" /></svg>
);
const ToolsIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z" /></svg>
);
