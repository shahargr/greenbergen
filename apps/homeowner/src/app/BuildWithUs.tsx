"use client";

import { useState } from "react";
import { inquireBuild } from "./inquire";

// BUILD WITH US - the new-build lead form on the front door.
//
// The site's one measure is inquiries (action a8d869ca), so the form asks
// for the least that lets somebody call back: a name, one way to reach you,
// and - because a new build starts with ground - where the lot is, if there
// is one. Everything else is a conversation.
export function BuildWithUs({ projectId, phone }: { projectId: string | null; phone: string | null }) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [lot, setLot] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  if (!projectId) {
    return phone
      ? <p className="small" style={{ margin: 0 }}>Call or text <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> and we will take it from there.</p>
      : null;
  }
  if (done) {
    return (
      <p className="small" style={{ margin: 0 }}>
        <strong>Got it.</strong> A person will be in touch shortly{phone ? <>, or call us at <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a></> : null}.
      </p>
    );
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const c = contact.trim();
    const isEmail = c.includes("@");
    if (!c) { setErr("Leave a phone number or an email so we can reach you."); return; }
    setBusy(true);
    const res = await inquireBuild({
      projectId: projectId!,
      name: name.trim(),
      phone: isEmail ? null : c,
      email: isEmail ? c : null,
      lot: lot.trim() || null,
      message: message.trim() || null,
    });
    setBusy(false);
    if ("error" in res) { setErr(res.error); return; }
    setDone(true);
  }

  return (
    <form onSubmit={send} className="stack" style={{ gap: 10 }} id="build">
      <div className="row" style={{ gap: 8 }}>
        <label className="field grow" style={{ marginBottom: 0 }}>
          <span className="field-label">Your name</span>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="field grow" style={{ marginBottom: 0 }}>
          <span className="field-label">Phone or email</span>
          <input className="input" required value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="tel" inputMode="email" />
        </label>
      </div>
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">The lot, or the town <span className="text-muted">(if you have one in mind)</span></span>
        <input className="input" value={lot} onChange={(e) => setLot(e.target.value)} placeholder="An address, a town, or “still looking”" />
      </label>
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">What you are thinking <span className="text-muted">(optional)</span></span>
        <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder="Size, timing, budget range, what matters most to you" />
      </label>
      {err && <p className="tiny" style={{ color: "var(--color-danger)", margin: 0 }}>{err}</p>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? "Sending…" : "Start the conversation"}</button>
      <p className="tiny text-muted" style={{ margin: 0 }}>
        A person reads this, not a queue. Nothing is charged and nothing is promised until we have talked.
      </p>
    </form>
  );
}
