"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emailInvitation } from "./actions";

const ResidentArt = () => (
  <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 22 24 7l18 15" />
    <path d="M10 20v20h28V20" />
    <path d="M20 40v-9h8v9" />
    <path d="M24 20.5c-1.8-2-4.8-1.4-5.5.8-.5 1.7.6 3 2.1 4.3L24 28l3.4-2.4c1.5-1.3 2.6-2.6 2.1-4.3-.7-2.2-3.7-2.8-5.5-.8z" strokeWidth="1.8" />
  </svg>
);

const ContractorArt = () => (
  <svg width="44" height="44" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 30a14 14 0 0 1 28 0z" />
    <path d="M19 19v-5h10v5" />
    <path d="M6 35h36" />
    <path d="m30 35 3 6M18 35l-3 6" />
  </svg>
);

// Builds an invitation and hands it to the sender's channel of choice:
// "Send by email" goes through the app's mailer; the second button is
// "Share..." where a native share sheet exists (phones) and "Copy" elsewhere.
export function InviteBuilder({ isSuperadmin, senderName }: { isSuperadmin: boolean; senderName: string }) {
  const [asResident, setAsResident] = useState(true);
  const [asContractor, setAsContractor] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copyState, setCopyState] = useState("");
  const [sendState, setSendState] = useState("");

  const isEmailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!asResident && !asContractor) {
      setError("Pick at least one: resident, contractor, or both.");
      return;
    }
    if (!isEmailValid) {
      setError("Their email is required.");
      return;
    }
    setBusy(true);
    setLink("");
    const supabase = createClient();

    // Resident rights are the superset - a resident+contractor invite goes
    // out as a resident invitation, and /join lets them pick both roles.
    // Admin resident invites use invite_consumer (carries a project quota).
    const call =
      asResident && isSuperadmin
        ? supabase.rpc("invite_consumer", {
            p_email: email.trim(),
            p_name: name.trim() || null,
            p_note: comment.trim() || null,
          })
        : supabase.rpc("invite_peer", {
            p_kind: asResident ? "homeowner" : "contractor",
            p_email: email.trim(),
            p_name: name.trim() || null,
            p_note: comment.trim() || null,
          });

    const { data, error: err } = await call;
    setBusy(false);
    if (err || !data?.token) {
      setError(err?.message ?? data?.reason ?? "Could not create the invitation.");
      return;
    }
    setLink(`${window.location.origin}/join?invite=${data.token}`);
    setCopyState("");
    setSendState("");
  }

  const messageText =
    `${senderName} invited you to Green Bergen` +
    (comment.trim() ? ` — "${comment.trim()}"` : "") +
    `. Sign up here: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopyState("copied");
      return;
    } catch {}
    try {
      const ta = document.createElement("textarea");
      ta.value = messageText;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      setCopyState(ok ? "copied" : "failed");
    } catch {
      setCopyState("failed");
    }
  }

  // Share sheet where one exists (phones); otherwise this quietly copies.
  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: "Green Bergen", text: messageText });
        return;
      } catch {}
    }
    await copy();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <form onSubmit={create} className="card" style={{ padding: "18px 20px", display: "grid", gap: 12 }}>
        <div className="typecards">
          <label className={asResident ? "typecard art on" : "typecard art"}>
            <input type="checkbox" checked={asResident} onChange={(e) => setAsResident(e.target.checked)} hidden />
            <span className="typecard-art"><ResidentArt /></span>
            <strong>Resident</strong>
            <span className="muted small">Manage their home and its projects.</span>
          </label>
          <label className={asContractor ? "typecard art on" : "typecard art"}>
            <input type="checkbox" checked={asContractor} onChange={(e) => setAsContractor(e.target.checked)} hidden />
            <span className="typecard-art"><ContractorArt /></span>
            <strong>Contractor</strong>
            <span className="muted small">Deliver services on our projects.</span>
          </label>
        </div>
        <p className="muted small" style={{ margin: 0 }}>Both can be selected — plenty of contractors own homes too.</p>

        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="inv-email">Their email (required)</label>
            <input id="inv-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="inv-name">Their name (optional)</label>
            <input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="inv-comment">Add a comment (optional — travels with the invitation)</label>
          <input id="inv-comment" className="input" value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder="e.g. This is the app I told you about" />
        </div>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
        <div>
          <button className="btn" disabled={busy}>{busy ? "Creating..." : "Create invitation"}</button>
        </div>
      </form>

      {link && (
        <div className="card" style={{ padding: "18px 20px", display: "grid", gap: 12 }}>
          <span className="section-title" style={{ marginBottom: 0 }}>Send it</span>
          <code className="small" style={{ wordBreak: "break-all", background: "#f2f7f3", padding: "8px 10px", borderRadius: 8 }}>
            {link}
          </code>
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              disabled={sendState === "Sending..."}
              onClick={async () => {
                setSendState("Sending...");
                const res = await emailInvitation(email.trim(), messageText);
                setSendState(res?.error ? `Email failed: ${res.error}` : `Sent to ${email.trim()} ✓`);
              }}
            >
              {sendState === "Sending..." ? "Sending..." : "Send by email"}
            </button>
            <button type="button" className="btn ghost" onClick={share}>
              {copyState === "copied" ? "Copied ✓" : "Share…"}
            </button>
          </div>
          {sendState && sendState !== "Sending..." && (
            <p className={`small ${sendState.startsWith("Email failed") ? "error" : "muted"}`} style={{ margin: 0 }}>
              {sendState}
            </p>
          )}
          {copyState === "failed" && (
            <p className="error small" style={{ margin: 0 }}>
              Copy was blocked by the browser &mdash; select the link above and copy it by hand.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
