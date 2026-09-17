"use client";

import { useState } from "react";
import { submitInquiry } from "./actions";

// Public inquiry form - submits through a server action that writes the lead
// (about_inquire -> project_inquiries -> lead task) and emails the admin.
//
// WHICH BOXES IT OFFERS IS THE PAGE'S BUSINESS, NOT THIS FORM'S. A house for
// sale asks whether you want to buy it; one for rent asks whether you want to
// rent it; a page that is just a page asks whether you have a question. The
// database decides the list (house_page().form.kinds) and hands it down, so
// the words on the button and the kinds the database will accept cannot
// drift apart.
const SAY: Record<string, string> = {
  question: "Ask a question",
  more_info: "Ask for details",
  site_visit: "Schedule site visit",
  buy: "I am interested in buying",
  rent: "I am interested in renting",
  tour: "Come and see it",
};
// The two that mean somebody standing at the door on a given day.
const DATED = ["site_visit", "tour"];

export function InquiryForm({ projectId, kinds }: { projectId: string; kinds?: string[] }) {
  const offer = (kinds ?? ["question", "site_visit"]).filter((k) => SAY[k]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState(offer[0] ?? "question");
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
      preferredDate: DATED.includes(kind) && date ? date : null,
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
          {offer.map((k) => (
            <label className="radio-opt" key={k}>
              <input
                type="radio"
                name="inq-kind"
                value={k}
                checked={kind === k}
                onChange={() => setKind(k)}
              />
              {SAY[k]}
            </label>
          ))}
          {DATED.includes(kind) && (
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
