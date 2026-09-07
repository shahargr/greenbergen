"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { deltaNotes, priceFor, type Package, type Selections } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { CloseIcon } from "@shared/ui";

// Screen 6 - the Adjust panel. Two tabs over the same levers: direct
// control (segmented controls and radios) and a chat that asks one fixed
// question per lever. The levers tab ships alone if chat is ever pulled.
type Turn = { who: "sys" | "me"; text: string };

export function AdjustPanel({ pkg, value, onChange, onClose }: { pkg: Package; value: Selections; onChange: (s: Selections) => void; onClose: () => void }) {
  const [tab, setTab] = useState<"levers" | "chat">("levers");
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
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Adjust the package" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="title">Adjust the package</div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="tabbar" role="tablist">
          <button role="tab" aria-selected={tab === "levers"} onClick={() => setTab("levers")}>Levers</button>
          <button role="tab" aria-selected={tab === "chat"} onClick={() => setTab("chat")}>Chat</button>
        </div>

        {tab === "levers" ? (
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
            <button type="button" className="btn btn-primary btn-block blueprint" onClick={onClose}>Use this setup</button>
          </div>
        ) : (
          <ChatTab pkg={pkg} value={value} set={set} price={price} onDone={onClose} />
        )}
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

// The chat: a fixed question set, one lever per question, quick-reply chips
// that map to options; a typed answer is matched against the chip words.
function ChatTab({ pkg, value, set, price, onDone }: { pkg: Package; value: Selections; set: (k: string, v: string) => void; price: number | null; onDone: () => void }) {
  const levers = pkg.levers.filter((l) => l.question);
  const [i, setI] = useState(0);
  const [turns, setTurns] = useState<Turn[]>(levers.length ? [{ who: "sys", text: levers[0]!.question! }] : []);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns]);

  const current = levers[i];
  const done = i >= levers.length;

  function answer(optKey: string, said: string) {
    if (!current) return;
    set(current.key, optKey);
    const opt = current.options.find((o) => o.key === optKey)!;
    const next = levers[i + 1];
    const ack = `Got it — ${opt.label.toLowerCase()}.` + (opt.price_delta_cents ? ` That's ${dollars(opt.price_delta_cents, { sign: true })}.` : "");
    setTurns((t) => [...t, { who: "me", text: said }, { who: "sys", text: next ? `${ack} ${next.question}` : `${ack} That's everything I need — the price on the left is your setup.` }]);
    setI(i + 1);
    setDraft("");
  }

  function typed(e: React.FormEvent) {
    e.preventDefault();
    if (!current || !draft.trim()) return;
    const d = draft.toLowerCase();
    const hit = current.options.find((o) => [o.label, o.chip ?? "", o.key].some((s) => s && d.includes(s.toLowerCase().split(" ")[0]!)));
    if (hit) answer(hit.key, draft.trim());
    else setTurns((t) => [...t, { who: "me", text: draft.trim() }, { who: "sys", text: `I didn't catch that. Pick one: ${current.options.map((o) => o.chip ?? o.label).join(", ")}.` }]);
    setDraft("");
  }

  return (
    <div className="body" style={{ gap: 10 }}>
      {current && <div className="kicker">Question {i + 1} of {levers.length}</div>}
      <div className="thread">
        {turns.map((t, k) => <div key={k} className={`bubble ${t.who === "me" ? "me" : ""}`}>{t.text}</div>)}
        {current && (
          <div className="chips">
            {current.options.map((o) => (
              <button key={o.key} type="button" className={`btn btn-secondary ${value[current.key] === o.key ? "tag-accent" : ""}`} onClick={() => answer(o.key, o.chip ?? o.label)}>{o.chip ?? o.label}</button>
            ))}
          </div>
        )}
        <div ref={endRef} />
      </div>
      <div className="between" style={{ borderTop: "1px solid var(--color-divider)", paddingTop: 8 }}>
        <span className="small text-muted">Price so far</span>
        <strong className="mono" style={{ fontFamily: "var(--font-heading)", fontSize: 22 }}>{dollars(price)}</strong>
      </div>
      {done ? (
        <button type="button" className="btn btn-primary btn-block blueprint" onClick={onDone}>Use this setup</button>
      ) : (
        <form className="row" onSubmit={typed}>
          <input className="input grow" placeholder="Or type an answer…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          <button className="btn btn-primary btn-icon" aria-label="Send" disabled={!draft.trim()}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </form>
      )}
    </div>
  );
}
