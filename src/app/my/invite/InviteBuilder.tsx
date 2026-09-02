"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { emailInvitation } from "./actions";

// Builds an invitation and hands it to the sender's channel of choice:
// "Send by email" goes through the app's mailer; "Share..." opens the phone's
// native share sheet (Messages, WhatsApp, anything installed - falls back to
// copy on desktop); "Copy" copies the message with the link.
export function InviteBuilder({ isSuperadmin, senderName }: { isSuperadmin: boolean; senderName: string }) {
  const [kind, setKind] = useState<"homeowner" | "contractor">("homeowner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [link, setLink] = useState("");
  const [copyState, setCopyState] = useState("");
  const [sendState, setSendState] = useState("");

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
    setCopyState("");
    setSendState("");
  }

  const isEmailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());

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
    // Fallback for browsers that block the clipboard API.
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

  async function share() {
    // The OS share sheet (Messages, WhatsApp, anything installed). Desktop
    // browsers mostly lack it - fall back to copying.
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
            {isEmailValid && (
              <button
                type="button"
                className="btn"
                disabled={sendState === "Sending..."}
                onClick={async () => {
                  setSendState("Sending...");
                  const res = await emailInvitation(email.trim(), messageText);
                  setSendState(res?.error ? `Email failed: ${res.error}` : `Sent to ${email.trim()} \u2713`);
                }}
              >
                {sendState === "Sending..." ? "Sending..." : "Send by email"}
              </button>
            )}
            <button type="button" className="btn ghost share-btn" onClick={share}>
              Share&hellip;
            </button>
            <button type="button" className="btn ghost" onClick={copy}>
              {copyState === "copied" ? "Copied \u2713" : "Copy"}
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
          {!isEmailValid && (
            <p className="muted small" style={{ margin: 0 }}>
              Add their email above to send it from the app directly.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
