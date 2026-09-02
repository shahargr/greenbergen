"use client";

import { useState } from "react";
import { submitInquiry } from "./actions";

// Public inquiry form - submits through a server action that writes the lead
// (about_inquire -> project_inquiries -> lead task) and emails the admin.
export function InquiryForm({ projectId }: { projectId: string }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState("question");
  const [message, setMessage] = useState("");
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!phone.trim() && !email.trim()) {
      setError("Leave a phone number or an email so we can reach you.");
      return;
    }
    setBusy(true);
    const res = await submitInquiry({
      projectId,
      name: name.trim(),
      phone: phone.trim() || null,
      email: email.trim() || null,
      kind,
      message: message.trim() || null,
      preferredDate: kind === "site_visit" && date ? date : null,
    });
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setDone(true);
  }

  if (done) {
    return <p style={{ margin: 0 }}>Thank you — we&apos;ll get back to you shortly.</p>;
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="inq-name">Name</label>
        <input id="inq-name" className="input" required value={name}
          onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-2col">
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="inq-phone">Phone</label>
          <input id="inq-phone" className="input" type="tel" autoComplete="tel" value={phone}
            onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="inq-email">Email</label>
          <input id="inq-email" className="input" type="email" autoComplete="email" value={email}
            onChange={(e) => setEmail(e.target.value)} />
        </div>
      </div>
      <p className="muted small" style={{ margin: "-4px 0 0" }}>One of phone or email is enough.</p>
      <div role="radiogroup" aria-label="I'd like to">
        <div className="radio-legend">I&apos;d like to</div>
        <div className="radio-row">
        <label className="radio-opt">
          <input
            type="radio"
            name="inq-kind"
            value="question"
            checked={kind === "question"}
            onChange={() => setKind("question")}
          />
          Ask a question
        </label>
        <label className="radio-opt">
          <input
            type="radio"
            name="inq-kind"
            value="site_visit"
            checked={kind === "site_visit"}
            onChange={() => setKind("site_visit")}
          />
          Schedule site visit
        </label>
          {kind === "site_visit" && (
            <input
              className="input date-inline"
              type="date"
              aria-label="Preferred date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          )}
        </div>
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="inq-msg">Message</label>
        <textarea id="inq-msg" className="input" rows={3} value={message}
          onChange={(e) => setMessage(e.target.value)} />
      </div>
      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      <div>
        <button className="btn" disabled={busy}>{busy ? "Sending..." : "Send"}</button>
      </div>
    </form>
  );
}
