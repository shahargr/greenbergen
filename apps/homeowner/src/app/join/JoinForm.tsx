"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { GoogleMark } from "@shared/SignIn";
import { isBergenZip, townForZip } from "@shared/bergen";
import { friendly, isMissingFunction } from "@shared/rpc";
import { AppBar, Notice, Screen } from "@shared/ui";
import { withBase } from "@shared/site";

// The account, in one form. Signing up and signing in are the same act
// (Supabase email OTP); the database trigger makes the app_users row and
// the customer agreement, then homeowner_register adds the ZIP, the town,
// the phone and the silent referral.
//
// TWO PLACES IT LIVES. On its own at /join (a screen of its own, with the
// app bar), and EMBEDDED at checkout - the last step of a booking, a quote,
// a group purchase, a "tell me when it opens" (Shahar, 2026-09-10: a
// visitor buys first and registers last, and that applies to every book-now
// flow). Embedded, it draws no screen of its own, takes its title from the
// caller, and hands control back with onDone instead of navigating.
//
// NEW OR ALREADY A MEMBER is not a question the form asks (Shahar: "why
// do we need already-member when Google sign-in is presented?"). Google
// signs in whoever you are, and so does the email code. The form asks
// name, email, phone, and the ZIP unless the flow already knows the
// address; a member typing their own name again loses nothing. Who you
// were is read AFTER the sign-in: homes on file means a member, and the
// caller hears it (onMember) - the booking wizard reloads to offer those
// homes rather than book a typed address as a new one.
//
// The Google path has to leave the page; the caller is told first
// (onBeforeGoogle) so it can put the half-filled booking somewhere safe.

const COMMON_DOMAINS = ["gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "icloud.com", "aol.com"];

function emailSuggestion(email: string): string | null {
  const m = email.toLowerCase().match(/^([^@]+)@([^@]+)$/);
  if (!m) return null;
  const [, user, domain] = m;
  if (COMMON_DOMAINS.includes(domain!)) return null;
  // Missing TLD ("gmail") or a one-letter slip ("gmial.com").
  for (const d of COMMON_DOMAINS) {
    const root = d.split(".")[0]!;
    if (domain === root || domain === `${root}.co` || domain === `${root}.con`) return `${user}@${d}`;
    if (domain!.length === d.length && [...domain!].filter((ch, i) => ch !== d[i]).length <= 2 && domain!.endsWith(".com")) return `${user}@${d}`;
  }
  return null;
}

const digits = (s: string) => s.replace(/\D/g, "");
// A 5-digit ZIP inside a typed address, when the flow already has one.
export const zipIn = (address: string | null | undefined) => address?.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] ?? "";

export type JoinEmbed = {
  title: string;
  lead?: string;
  // The address the flow already holds; its ZIP is used and not asked again.
  address?: string | null;
  // Signed in as a NEW member (code path): the caller carries on.
  onDone: () => void;
  // Signed in as an EXISTING member: the caller may want their homes.
  // Defaults to onDone.
  onMember?: () => void;
  onBeforeGoogle?: () => void;
};

export function JoinForm({ refId, prefillName, next, embed }: { refId: string | null; prefillName: string; next: string; embed?: JoinEmbed }) {
  const router = useRouter();
  const knownZip = zipIn(embed?.address);
  const [name, setName] = useState(prefillName);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [zip, setZip] = useState(knownZip);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"form" | "code">("form");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; phone?: string; zip?: string; submit?: string }>({});
  const [outside, setOutside] = useState(false);

  const suggestion = emailSuggestion(email);
  const askZip = !knownZip || !isBergenZip(knownZip);

  // The fields, checked.
  function check(needEmail: boolean): boolean {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Your name, so the contractor knows who to ask for.";
    if (embed && digits(phone).length < 10) errs.phone = "A number the contractor can reach you on.";
    if (!/^\d{5}$/.test(zip.trim())) errs.zip = "A 5-digit ZIP code.";
    else if (!isBergenZip(zip.trim())) { errs.zip = `${zip.trim()} is outside Bergen County. We're Bergen-only for now — we'll save your email and tell you when we expand.`; setOutside(true); }
    if (needEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = suggestion ? `That email looks unfinished — did you mean ${suggestion}?` : "That email looks unfinished.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!check(true)) return;
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { data: { full_name: name.trim() }, emailRedirectTo: `${window.location.origin}${withBase("/auth/confirm")}?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) {
      setErrors({ submit: /rate|too many/i.test(error.message) ? "Too many tries in a row. Give it a minute and try again." : "Your connection dropped. Nothing was lost — tap Continue to try again." });
      return;
    }
    setStep("code");
  }

  // Same fields, then Google instead of a code. The finish route registers
  // the ZIP, phone and referral once Google sends the browser back.
  async function google() {
    if (!check(false)) return;
    setBusy(true);
    embed?.onBeforeGoogle?.();
    const supabase = createClient();
    const finish = `/join/finish?${new URLSearchParams({ name: name.trim(), zip: zip.trim(), ...(digits(phone) ? { phone: phone.trim() } : {}), ...(refId ? { ref: refId } : {}), next }).toString()}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${withBase("/auth/confirm")}?next=${encodeURIComponent(finish)}` },
    });
    if (error) { setBusy(false); setErrors({ submit: /not enabled|unsupported provider/i.test(error.message) ? "Google sign-in isn't switched on for this project yet. Use the email code." : error.message }); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6,10}$/.test(code.trim())) { setErrors({ submit: "Type the whole code from the email." }); return; }
    setBusy(true);
    setErrors({});
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) {
      setBusy(false);
      setErrors({ submit: /expired/i.test(error.message) ? "That code expired. Go back and we'll send a fresh one." : "That code didn't match. Check the email and try again." });
      return;
    }
    // Who signed in? Homes on file means a member who was here before; the
    // caller may want those homes rather than what was typed.
    let member = false;
    if (embed) {
      const { data: meRow } = await supabase.rpc("homeowner_me");
      member = Array.isArray(meRow?.homes) && meRow.homes.length > 0;
    }
    if (!member) {
      // The profile row exists now (signup trigger). Add ZIP, town, phone, referral.
      const { error: regErr } = await supabase.rpc("homeowner_register", {
        p_full_name: name.trim(), p_zip: zip.trim(), p_town: townForZip(zip.trim()), p_ref: refId, p_phone: digits(phone) ? phone.trim() : null,
      });
      if (regErr && !isMissingFunction(regErr)) console.warn("homeowner_register:", friendly(regErr.message));
    }
    if (embed) {
      // The caller keeps going; the server-rendered parts of the page learn
      // about the session on their next render.
      router.refresh();
      if (member) (embed.onMember ?? embed.onDone)(); else embed.onDone();
      return;
    }
    router.replace(next);
    router.refresh();
  }

  // On its own: a screen with the app bar. Embedded: the form alone.
  const shell = (back: (() => void) | string, inner: ReactNode) =>
    embed
      ? <div className="stack" style={{ gap: 14 }}>{inner}</div>
      : <Screen><AppBar back={back} />{inner}</Screen>;
  const formClass = embed ? "stack" : "body";
  // Embedded, the buttons sit in the flow. ".actions" is the screen's sticky
  // bottom bar, and a form inside another screen's bar floated over the page.
  const actionsClass = embed ? "stack" : "actions";
  const actionsStyle = embed ? { gap: 8 } : { padding: 0, marginTop: "auto" as const };

  if (step === "code") {
    return shell(() => setStep("form"), (
      <form className={formClass} onSubmit={verify} noValidate>
        <div className="hero">
          <h1>Check your email.</h1>
          <p className="lead">We sent a sign-in code to <strong>{email.trim()}</strong>. It&apos;s good for five minutes.{embed ? " Type it here and you carry on where you were." : " The link in the email works too."}</p>
        </div>
        <label className="field">
          <span className="field-label">Code</span>
          <input className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10}
            placeholder="12345678" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus
            style={{ fontSize: 28, letterSpacing: "0.3em", textAlign: "center", fontFamily: "var(--font-heading)" }} />
        </label>
        {errors.submit && <Notice kind="error">{errors.submit}</Notice>}
        <p className="small text-muted">Nothing arrived? Look in spam, or <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0, fontSize: 13 }} onClick={() => setStep("form")}>go back and resend</button>.</p>
        <div className={actionsClass} style={actionsStyle}>
          <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={busy || code.length < 6}>
            {busy ? <><span className="spin" /> Signing you in…</> : "Continue"}
          </button>
        </div>
      </form>
    ));
  }

  return shell("/", (
    <form className={formClass} onSubmit={submit} noValidate>
      <div className="hero">
        <h1>{embed?.title ?? "Three fields. That's it."}</h1>
        <p className="lead">{embed?.lead ?? "We'll ask about your home only when a project needs it."}</p>
      </div>

      <label className="field">
        <span className="field-label">Full name</span>
        <input className={`input ${errors.name ? "invalid" : ""}`} autoComplete="name" placeholder="Marta Feld" value={name} onChange={(e) => setName(e.target.value)} />
        {errors.name && <p className="hint error">{errors.name}</p>}
      </label>
      <label className="field">
        <span className="field-label">Email</span>
        <input className={`input ${errors.email ? "invalid" : ""}`} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        {errors.email ? (
          <p className="hint error">
            {suggestion ? <>That email looks unfinished — did you mean <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0, fontSize: 12, fontFamily: "inherit", fontWeight: 600 }} onClick={() => setEmail(suggestion)}>{suggestion}</button>?</> : errors.email}
          </p>
        ) : suggestion ? (
          <p className="hint">Did you mean <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0, fontSize: 12, fontFamily: "inherit", fontWeight: 600 }} onClick={() => setEmail(suggestion)}>{suggestion}</button>?</p>
        ) : null}
      </label>
      <label className="field">
        <span className="field-label">Phone {embed ? "" : <span className="text-muted">(optional)</span>}</span>
        <input className={`input ${errors.phone ? "invalid" : ""}`} type="tel" inputMode="tel" autoComplete="tel" placeholder="(201) 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {errors.phone ? <p className="hint error">{errors.phone}</p> : embed ? <p className="hint">For the contractor on the day, and for us if a question comes up.</p> : null}
      </label>
      {askZip && (
        <label className="field">
          <span className="field-label">ZIP code</span>
          <input className={`input ${errors.zip ? "invalid" : ""}`} inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="07666" value={zip}
            onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setOutside(false); }} />
          {errors.zip && <p className="hint error">{errors.zip}</p>}
          {!errors.zip && isBergenZip(zip) && <p className="hint">{townForZip(zip)} — you&apos;re in.</p>}
        </label>
      )}
      {!askZip && <p className="small text-muted" style={{ margin: 0 }}>{townForZip(knownZip)}, from the address you gave. No card.</p>}
      {askZip && !embed && <p className="small text-muted" style={{ margin: 0 }}>No address, no card. Prices are the same for everyone in the community.</p>}
      {embed && <p className="small text-muted" style={{ margin: 0 }}>Already a member? Same email, and Google or the code signs you straight in.</p>}

      {errors.submit && <Notice kind="error" title="We couldn't save that.">{errors.submit}</Notice>}

      {/* Google leads, same as the sign-in screen. It sits below the fields
          rather than above them because the name and ZIP have to be captured
          before we hand off to Google, but of the two ways in it is first. */}
      <div className={actionsClass} style={actionsStyle}>
        <button type="button" className="btn btn-primary btn-block" onClick={() => void google()} disabled={busy || outside}><GoogleMark /> Continue with Google</button>
        <div className="divider-label" style={{ justifyContent: "center" }}><span>or</span></div>
        <button className={`btn btn-secondary btn-block ${busy ? "busy" : ""}`} disabled={busy || outside}>
          {busy ? <><span className="spin" /> One moment…</> : errors.submit ? "Try again" : "Email me a code"}
        </button>
        {!embed && <p className="small text-muted center" style={{ margin: "4px 0 0" }}>Already in? <Link href="/login">Sign in</Link></p>}
      </div>
    </form>
  ));
}
