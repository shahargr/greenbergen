"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@shared/supabase/client";
import { friendly, isMissingFunction } from "@shared/rpc";
import { Blueprint, Notice, StatusHero } from "@shared/ui";

// The get-a-quote track and the "something else" tile: one sentence from
// the homeowner becomes one task in the unified list, for a person to
// answer. No price is shown because none is honest yet.
export function QuoteForm({ code, signedIn, prompt = "What do you have in mind?", cta = "Send it to a person" }: { code: string; signedIn: boolean; prompt?: string; cta?: string }) {
  const [note, setNote] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) { setErr("A sentence is enough."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("homeowner_quote_request", { p_code: code, p_note: note.trim(), p_address: address.trim() || null });
    setBusy(false);
    if (error) { setErr(isMissingFunction(error) ? "This part isn't switched on yet — text us instead and a person answers." : friendly(error.message)); return; }
    if (!data?.ok) { setErr(friendly(data?.reason)); return; }
    setDone(true);
  }

  if (done) {
    return (
      <StatusHero kicker="Sent" title="A person has it.">
        We&apos;ll come back to you by email within a couple of days with a quote or a clear next step. Nothing is charged, nothing is promised yet.
      </StatusHero>
    );
  }

  if (!signedIn) {
    return (
      <Blueprint pad>
        <p style={{ margin: 0 }}>Join first (three fields), and a person comes back to you by email.</p>
        <Link href={`/join?next=${encodeURIComponent(`/packages/${code}`)}`} className="btn btn-primary btn-block blueprint" style={{ marginTop: 10 }}>Join the community</Link>
      </Blueprint>
    );
  }

  return (
    <form onSubmit={submit} className="stack">
      <label className="field">
        <span className="field-label">{prompt}</span>
        <textarea className="input" rows={4} placeholder="A sentence is enough — we'll ask the rest." value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Address <span className="text-muted">(optional)</span></span>
        <input className="input" autoComplete="street-address" placeholder="14 Elm St, Teaneck" value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      {err && <Notice kind="error">{err}</Notice>}
      <button className={`btn btn-primary btn-block blueprint ${busy ? "busy" : ""}`} disabled={busy}>{busy ? <><span className="spin" /> Sending…</> : cta}</button>
    </form>
  );
}
