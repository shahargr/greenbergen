"use client";

import { useState } from "react";
import { SITE_ORIGIN } from "@shared/site";

// THE LINK YOU SEND HIM (Shahar, 2026-09-17, path 2: "Link is shared with the
// contractor where he can log his price even without loging into the system").
//
// Three ways out, in the order they actually get used on a phone: text it,
// because you have his number and he met you this morning; email it, because
// some firms want it in writing; copy it, because sometimes it goes into
// WhatsApp or a thread you are already in.
//
// The message text comes from the database (portal_bid_link), not from here,
// so every door says the same thing and the wording can be fixed in one place.
//
// TEXT AND EMAIL ARE HANDED TO THE PHONE. sms: and mailto: open the app the
// person already uses with the words filled in; we never send on their behalf,
// which means no mail server, no deliverability, no "did it arrive?" - it
// arrives from his own number, which is also the one a contractor answers.
export function BidLink({ token, who, phone, email, message, sentAt, openedAt, onSent }: {
  token: string;
  who: string | null;
  phone: string | null;
  email: string | null;
  message: string;
  sentAt: string | null;
  openedAt: string | null;
  /** Records that it went out - a server action bound to this bid. */
  onSent: (how: string) => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const url = `${SITE_ORIGIN}/bid/${token}`;
  const body = `${message}\n\n${url}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      void onSent("copy");
    } catch {
      // Clipboard refused (an insecure context, an old browser): the box
      // below still holds the link and a long press still copies it.
      setCopied(false);
    }
  };

  return (
    <div className="bl">
      <div className="bl-head">
        <span className="t">His own link</span>
        {openedAt
          ? <span className="tag tag-ok">opened</span>
          : sentAt ? <span className="tag tag-outline">sent</span>
          : <span className="tag tag-neutral">not sent</span>}
      </div>
      <p className="tiny text-muted" style={{ margin: "0 0 8px" }}>
        {who ?? "They"} can put a price in from this without signing in to anything.
      </p>

      <div className="bl-acts">
        {phone && (
          <a className="btn btn-primary small" href={`sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`}
            onClick={() => { void onSent("sms"); }}>Text it</a>
        )}
        {email && (
          <a className="btn btn-secondary small"
            href={`mailto:${email}?subject=${encodeURIComponent("Pricing " + (message.includes(" the ") ? message.split(" the ")[1]?.split(" scope")[0] ?? "the work" : "the work"))}&body=${encodeURIComponent(body)}`}
            onClick={() => { void onSent("email"); }}>Email it</a>
        )}
        <button type="button" className="btn btn-ghost small" onClick={() => { void copy(); }}>
          {copied ? "Copied" : "Copy the link"}
        </button>
      </div>

      <input className="input bl-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()}
        aria-label="The link" />
    </div>
  );
}
