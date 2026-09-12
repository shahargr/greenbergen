"use client";

import { useEffect, useMemo } from "react";
import { deltaNotes, priceFor, type Package, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { CloseIcon } from "@shared/ui";

// Screen 6 - the Adjust panel: the choices that move the price, as
// segmented controls and radios.
//
// Shahar (2026-09-12): "Change the 'Levers' to customize. Remove the chat for
// now." Two things, and both are right. "Levers" is our word for them - the
// database calls them levers and it should, because that is what they are to
// the people who set them up - but a member is CUSTOMISING their package, and
// the tab said the wrong one out loud. And the chat asked one fixed question
// per lever in a conversation costume: slower than the controls beside it,
// and it promised a conversation it could not have.
//
// The chat is removed, not hidden - the questions it asked live on each lever
// (lever.question) and are still in the database, so bringing it back is a
// component, not a migration. With one pane left there is no tab bar either.

export function AdjustPanel({ pkg, value, onChange, onClose }: { pkg: Package; value: Selections; onChange: (s: Selections) => void; onClose: () => void }) {
  const price = priceFor(pkg, value);
  const deltas = useMemo(() => deltaNotes(pkg, value), [pkg, value]);
  const set = (k: string, v: string) => onChange({ ...value, [k]: v });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [onClose]);

  return (
    <div className="sheet-back" onClick={onClose} role="presentation">
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Customise the package" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="title">Customise the package</div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="body">
            {pkg.levers.map((lever) => (
              <div className="field" key={lever.key}>
                <span className="field-label">{lever.label}</span>
                {lever.control === "seg" ? (
                  <div className="seg" role="radiogroup" aria-label={lever.label}>
                    {lever.options.map((o) => (
                      <label className="seg-opt" key={o.key}>
                        <input type="radio" name={`lv-${lever.key}`} checked={value[lever.key] === o.key} onChange={() => set(lever.key, o.key)} />
                        {o.label}
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="stack" style={{ gap: 8 }}>
                    {lever.options.map((o) => (
                      <label className="radio" key={o.key}>
                        <input type="radio" name={`lv-${lever.key}`} checked={value[lever.key] === o.key} onChange={() => set(lever.key, o.key)} />
                        <span className="dot" />
                        <span>{o.label}{o.price_delta_cents !== 0 && <span className="text-muted small"> · {dollars(o.price_delta_cents, { sign: true })}</span>}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            ))}
          <PriceFooter price={price} base={pkg.base_price_cents} deltas={deltas} />
          <button type="button" className="btn btn-primary btn-block" onClick={onClose}>Use this setup</button>
        </div>
      </div>
    </div>
  );
}

function PriceFooter({ price, base, deltas }: { price: number | null; base: number | null; deltas: string[] }) {
  return (
    <div className="price" style={{ padding: "8px 0 0" }}>
      <div className="kicker">Updated price</div>
      <div className="big mono" key={price ?? 0} style={{ fontSize: 34 }}>
        {dollars(price)}{base != null && price !== base && <span className="was">{dollars(base)}</span>}
      </div>
      {deltas.length > 0 && <div className="delta">{deltas.join(" · ")}</div>}
      <p className="hint" style={{ margin: 0 }}>Moves as you adjust. It can go up or down once the contractor sees your photos.</p>
    </div>
  );
}
