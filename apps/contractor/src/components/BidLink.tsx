"use client";

import { useState } from "react";
import { SITE_ORIGIN } from "@shared/site";
import { formatPhone } from "@/lib/phone";

// THE LINK YOU SEND HIM (Shahar, 2026-09-17, path 2: "Link is shared with the
// contractor where he can log his price even without loging into the system").
//
// Four ways out, in the order they actually get used on a phone: text it from
// the platform, because you have his number and he met you this morning; open
// your own Messages app with the words filled in, because that is the number
// he already answers; email it, because some firms want it in writing; copy
// it, because sometimes it goes into WhatsApp or a thread you are already in.
//
// The message text comes from the database (portal_bid_link), not from here,
// so every door says the same thing and the wording can be fixed in one place.
//
// THE PLATFORM CAN SEND ON YOUR BEHALF (migration 247), once the admin has
// switched texting on: sendNow is a server action bound to this bid, and the
// database composes the text and posts it to Twilio from Green Bergen's own
// number, so nobody leaves the screen. It is offered first, because it is the
// one press that both sends and records. The phone's own Messages app stays as
// the second way: sms: and mailto: open the app the person already uses with
// the words filled in, and it arrives from his own number.
export function BidLink({ token, who, phone, email, message, sentAt, openedAt, onSent, sendNow, testMode }: {
  token: string;
  who: string | null;
  phone: string | null;
  email: string | null;
  message: string;
  sentAt: string | null;
  openedAt: string | null;
  /** Records that it went out - a server action bound to this bid. */
  onSent: (how: string) => Promise<void>;
  /** Texts it from the platform - a server action bound to this bid. Absent when texting is off. */
  sendNow?: () => Promise<void>;
  /** Test mode logs the text instead of sending it, and the button says so. */
  testMode?: boolean;
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
        {sendNow && phone && (
          <form action={sendNow}>
            <button className="btn btn-primary small" type="submit">
              {testMode ? "Text it (test)" : "Text it from Green Bergen"}
            </button>
          </form>
        )}
        {phone && (
          <a className={`btn ${sendNow ? "btn-secondary" : "btn-primary"} small`}
            href={`sms:${phone.replace(/[^\d+]/g, "")}?&body=${encodeURIComponent(body)}`}
            onClick={() => { void onSent("sms"); }}>{sendNow ? "Open Messages" : "Text it"}</a>
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
      {/* Which number the text goes to, readable, so a wrong one is caught
          before the press rather than after; and when there is none, the one
          thing that would make the button appear. */}
      {sendNow && (
        <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>
          {phone ? `Text ${formatPhone(phone)}` : "Add his number to text him."}
        </p>
      )}

      <input className="input bl-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()}
        aria-label="The link" />
    </div>
  );
}
