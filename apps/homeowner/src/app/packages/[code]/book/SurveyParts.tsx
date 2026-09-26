"use client";

import type { ReactNode } from "react";
import { basePrice, marked, configLabel, deltaNotes, isHardware, payeeLine, paymentSteps, priceFor, type Lever, type LeverOption, type Package, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { PriceBlock } from "@shared/PriceBlock";
import { AppBar, Card, CheckIcon, Screen, StepKicker } from "@shared/ui";

// WHAT THE PRE-PRICE WALK-THROUGHS SHARE: the gas job's survey (PowerSurvey,
// migration 235) and the guided photos (GuidedSurvey, migration 236) ask a
// lever the same way, show the same progress line and end on the same
// proposal - the price, the setup, what is included, what you buy, how you pay.

export function WalkProgress({ step, of, time = "about a minute" }: { step: number; of: number; time?: string }) {
  return (
    <div className="survey-progress" aria-label={`Step ${step} of ${of}`}>
      <div className="bars">{Array.from({ length: of }, (_, i) => <span key={i} className={i < step ? "on" : ""} />)}</div>
      <div className="small text-muted"><strong>Step {step} of {of}</strong> · {time}</div>
    </div>
  );
}

// short: segments read the options' chips ("Cracked") and the line under
// them spells the chosen one out ("Cracks wider than a hairline").
export function ChoiceLever({ pkg, lever, value, onPick, short = false }: { pkg: Package; lever: Lever; value: string | undefined; onPick: (k: string) => void; short?: boolean }) {
  return (
    <section className="survey-q">
      <h2>{lever.question ?? lever.label}</h2>
      {lever.control === "seg" ? (
        <div className="seg" role="radiogroup" aria-label={lever.label}>
          {lever.options.map((o) => (
            <label className="seg-opt" key={o.key}>
              <input type="radio" name={`sv-${lever.key}`} checked={value === o.key} onChange={() => onPick(o.key)} />
              {short ? o.chip ?? o.label : o.label}
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
      <Delta pkg={pkg} lever={lever} value={value} spell={short} />
    </section>
  );
}

// pkg carries the viewer's mark-up, so a delta reads as the homeowner pays it.
export function Delta({ pkg, lever, value, spell = false }: { pkg: Package; lever: Lever; value: string | undefined; spell?: boolean }) {
  const o = lever.options.find((x) => x.key === value);
  if (!o) return null;
  return (
    <p className="tiny text-muted" style={{ margin: "4px 0 0" }}>
      {spell && o.chip && o.chip !== o.label ? `${o.label}. ` : ""}
      {o.price_delta_cents === 0 ? (o.is_default ? "Included in the price." : "No change to the price.") : `${dollars(marked(pkg, o.price_delta_cents), { sign: true })} to the price.`}
    </p>
  );
}

// ---- turn-key: the proposal -------------------------------------------------
// setup overrides how a lever's answer reads (the exact feet behind a band);
// children are the walk-through's own cards (the gas in the house, the
// photos taken); notice is anything left unanswered. onDiy, when given, is
// the DIY way out on the same screen.
export function ProposalView({ pkg, sel, setup, children, notice, onBack, onEdit, onAccept, onDiy }: {
  pkg: Package; sel: Selections;
  setup?: (l: Lever, o: LeverOption) => ReactNode | null;
  children?: ReactNode; notice?: ReactNode;
  onBack: () => void; onEdit: () => void; onAccept: () => void; onDiy?: () => void;
}) {
  const price = priceFor(pkg, sel);
  const deltas = deltaNotes(pkg, sel);
  const payments = paymentSteps(pkg, price);

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
          <PriceBlock cents={price} was={deltas.length ? basePrice(pkg) : null} config={configLabel(pkg, sel)} delta={deltas} kicker="Community price · turn-key" />
        </Card>

        <Card pad>
          <h6 style={{ marginBottom: 2 }}>Your setup</h6>
          <div className="kv-rows">
            {pkg.levers.map((l) => {
              const o = l.options.find((x) => x.key === sel[l.key]);
              if (!o) return null;
              return (
                <div key={l.key}>
                  <span className="k">{l.label}</span>
                  <span style={{ textAlign: "right" }}>
                    {setup?.(l, o) ?? o.label}
                    {o.price_delta_cents !== 0 && <span className="text-muted"> · {dollars(marked(pkg, o.price_delta_cents), { sign: true })}</span>}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        {children}

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
              {pkg.collected_by !== "green_bergen" && <div><span className="k">Today</span><span>Nothing</span></div>}
              {payments.map((m) => (
                <div key={m.key}>
                  <span className="k">{m.name}{m.pct != null ? ` · ${m.pct}%` : ""}{m.due ? ` · ${m.due}` : ""}</span>
                  <span className="mono">{dollars(m.cents)}</span>
                </div>
              ))}
            </div>
            <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>{payeeLine(pkg)}</p>
          </Card>
        )}

        {notice}

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block" onClick={onAccept}>Accept · book at {dollars(price)}</button>
          {onDiy && <button type="button" className="btn btn-secondary btn-block" onClick={onDiy}>I&apos;ll do it myself — add to my DIY projects</button>}
          <button type="button" className="btn btn-ghost btn-block" onClick={onEdit}>Change my answers</button>
          <p className="tiny text-muted center" style={{ margin: 0 }}>Next: which home, the house{onDiy ? "" : ", the photos"}. Nothing is charged today.</p>
        </div>
      </div>
    </Screen>
  );
}
