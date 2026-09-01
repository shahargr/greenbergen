"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Builds an invitation and hands it to whatever channel the sender prefers.
// No email provider is wired server-side, so sending happens through the
// sender's own apps: mail client, Messages, WhatsApp - or plain copy.
export function InviteBuilder({ isSuperadmin, senderName }: { isSuperadmin: boolean; senderName: string }) {
  const [kind, setKind] = useState<"homeowner" | "contractor">("homeowner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setLink("");
    const supabase = createClient();

    // Admin homeowner invites go through invite_consumer (carries a project
    // quota); everything else through invite_peer.
    const call =
      isSuperadmin && kind === "homeowner"
        ? supabase.rpc("invite_consumer", {
            p_email: email.trim() || null,
            p_name: name.trim() || null,
            p_note: comment.trim() || null,
          })
        : supabase.rpc("invite_peer", {
            p_kind: kind,
            p_email: email.trim() || null,
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
    setCopied(false);
  }

  const messageText =
    `${senderName} invited you to Green Bergen` +
    (comment.trim() ? ` — "${comment.trim()}"` : "") +
    `. Sign up here: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(messageText);
      setCopied(true);
    } catch {
      setError("Could not copy — select the link and copy it by hand.");
    }
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <form onSubmit={create} className="card" style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
        <div role="radiogroup" aria-label="Invite as">
          <div className="radio-legend">Invite them to</div>
          <div className="radio-row">
            <label className="radio-opt">
              <input type="radio" name="inv-kind" checked={kind === "homeowner"} onChange={() => setKind("homeowner")} />
              Manage their projects
            </label>
            <label className="radio-opt">
              <input type="radio" name="inv-kind" checked={kind === "contractor"} onChange={() => setKind("contractor")} />
              Deliver services
            </label>
          </div>
        </div>
        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="inv-name">Their name (optional)</label>
            <input id="inv-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="inv-email">Their email (optional)</label>
            <input id="inv-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
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
            <a
              className="btn"
              href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent("An invitation to Green Bergen")}&body=${encodeURIComponent(messageText)}`}
            >
              Email
            </a>
            <a className="btn ghost" href={`sms:?&body=${encodeURIComponent(messageText)}`}>Text</a>
            <a className="btn ghost" href={`https://wa.me/?text=${encodeURIComponent(messageText)}`} target="_blank" rel="noreferrer">
              WhatsApp
            </a>
            <button type="button" className="btn ghost" onClick={copy}>{copied ? "Copied ✓" : "Copy"}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            The link works for whoever opens it{email.trim() ? "" : " — no email is attached"}.
            Sending happens from your own mail or messaging app.
          </p>
        </div>
      )}
    </div>
  );
}
