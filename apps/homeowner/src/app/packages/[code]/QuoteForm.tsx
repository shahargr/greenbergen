"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@shared/supabase/client";
import { friendly, isMissingFunction } from "@shared/rpc";
import { Card, Notice, StatusHero } from "@shared/ui";

// The get-a-quote track, the "something else" tile and the community
// services: one sentence from the homeowner becomes one task in the unified
// list, for a person to answer. No price is shown because none is honest yet.
//
// THE ADDRESS IS A CHOICE, NOT A TEXT BOX. Shahar: "drop down for the
// addresses you created under your profile instead of free text." A member
// who has told us where they live should not be asked to type it again - and
// a typed address is a second copy of a fact the profile already holds,
// free to disagree with it. So: your homes, as a list; "Somewhere else" for
// the rental you have not added yet; and the plain box only for a member who
// has no home on file at all.
export type QuoteHome = { project_id: string; address: string | null; name: string | null };

const ELSEWHERE = "__elsewhere__";

type Reach = "email" | "phone" | "text";
const REACH: { key: Reach; label: string; back: string }[] = [
  { key: "email", label: "Email", back: "by email" },
  { key: "phone", label: "A call", back: "with a call" },
  { key: "text", label: "A text", back: "by text" },
];

export function QuoteForm({
  code, signedIn, homes = [], prompt = "What do you have in mind?", cta = "Send it to a person",
}: { code: string; signedIn: boolean; homes?: QuoteHome[]; prompt?: string; cta?: string }) {
  const withAddress = homes.filter((h) => !!h.address?.trim());
  const [note, setNote] = useState("");
  // The first home is the one homeowner_me puts first - the one with live
  // work on it, else the oldest - which is the likeliest answer.
  const [pick, setPick] = useState<string>(withAddress[0]?.address ?? ELSEWHERE);
  const [typed, setTyped] = useState("");
  // HOW TO REACH YOU (Shahar): email, a call, or a text. The task a person
  // picks up says which, with the number, and the confirmation says the
  // same thing back - so nobody waits by the wrong device.
  const [reach, setReach] = useState<Reach>("email");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  const address = withAddress.length === 0 ? typed : pick === ELSEWHERE ? typed : pick;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setErr("A sentence is enough."); return; }
    if (reach !== "email" && phone.replace(/\D/g, "").length < 10) { setErr("Add the number to reach you on."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("homeowner_quote_request", {
      p_code: code, p_note: note.trim(), p_address: address.trim() || null,
      p_reach: reach, p_phone: reach === "email" ? null : phone.trim(),
    });
    setBusy(false);
    if (error) { setErr(isMissingFunction(error) ? "This part isn't switched on yet — text us instead and a person answers." : friendly(error.message)); return; }
    if (!data?.ok) { setErr(friendly(data?.reason)); return; }
    setDone(true);
  }

  if (done) {
    return (
      <StatusHero kicker="Sent" title="A person has it.">
        We&apos;ll come back to you {REACH.find((r) => r.key === reach)?.back ?? "by email"}
        {reach !== "email" && phone ? ` on ${phone}` : ""} within a couple of days with a quote or a clear next step. Nothing is charged, nothing is promised yet.
      </StatusHero>
    );
  }

  if (!signedIn) {
    return (
      <Card pad>
        <p style={{ margin: 0 }}>Join first (three fields), and a person comes back to you by email.</p>
        <Link href={`/join?next=${encodeURIComponent(`/packages/${code}`)}`} className="btn btn-primary btn-block" style={{ marginTop: 10 }}>Join the community</Link>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        <span className="field-label">{prompt}</span>
        <textarea className="input" rows={4} placeholder="A sentence is enough — we'll ask the rest." value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {withAddress.length > 0 ? (
        <>
          <label className="field">
            <span className="field-label">Which home?</span>
            <select className="input" value={pick} onChange={(e) => setPick(e.target.value)}>
              {withAddress.map((h) => (
                <option key={h.project_id} value={h.address!}>
                  {h.name && h.name !== h.address ? `${h.name} — ${h.address}` : h.address}
                </option>
              ))}
              <option value={ELSEWHERE}>Somewhere else…</option>
            </select>
            <p className="hint">Your homes, from your profile. Add another one there and it appears here.</p>
          </label>
          {pick === ELSEWHERE && (
            <label className="field">
              <span className="field-label">Address <span className="text-muted">(optional)</span></span>
              <input className="input" autoComplete="street-address" placeholder="14 Elm St, Teaneck" value={typed} onChange={(e) => setTyped(e.target.value)} />
            </label>
          )}
        </>
      ) : (
        <label className="field">
          <span className="field-label">Address <span className="text-muted">(optional)</span></span>
          <input className="input" autoComplete="street-address" placeholder="14 Elm St, Teaneck" value={typed} onChange={(e) => setTyped(e.target.value)} />
          <p className="hint">Once a home is on your profile, it is offered here instead.</p>
        </label>
      )}

      <div className="field">
        <span className="field-label">How should we reach you?</span>
        <div className="seg" role="radiogroup" aria-label="How should we reach you?">
          {REACH.map((r) => (
            <label key={r.key} className="seg-opt">
              <input type="radio" name="reach" value={r.key} checked={reach === r.key} onChange={() => setReach(r.key)} />
              <span>{r.label}</span>
            </label>
          ))}
        </div>
        {reach === "email"
          ? <p className="hint">To the address you signed in with.</p>
          : (
            <label className="field" style={{ marginTop: 8 }}>
              <span className="field-label">Your number</span>
              <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(201) 555-0100" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <p className="hint">We keep it on your profile so you are not asked again.</p>
            </label>
          )}
      </div>

      {err && <Notice kind="error">{err}</Notice>}
      <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={busy}>{busy ? <><span className="spin" /> Sending…</> : cta}</button>
    </form>
  );
}
