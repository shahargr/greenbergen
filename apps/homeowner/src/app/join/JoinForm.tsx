"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { GoogleMark } from "@shared/SignIn";
import { isBergenZip, townForZip } from "@shared/bergen";
import { friendly, isMissingFunction } from "@shared/rpc";
import { AppBar, Notice, Screen } from "@shared/ui";
import { withBase } from "@shared/site";

// Three fields, then the code from the email (Supabase issues 8 digits;
// the field takes 6 to 10 so a project setting can't strand anyone). Signing up and
// signing in are the same act (Supabase email OTP); the database trigger
// makes the app_users row and the customer agreement, then
// homeowner_register adds the ZIP, the town and the silent referral.

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

export function JoinForm({ refId, prefillName, next }: { refId: string | null; prefillName: string; next: string }) {
  const router = useRouter();
  const [name, setName] = useState(prefillName);
  const [email, setEmail] = useState("");
  const [zip, setZip] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"form" | "code">("form");
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; email?: string; zip?: string; submit?: string }>({});
  const [outside, setOutside] = useState(false);

  const suggestion = emailSuggestion(email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Your name, so the contractor knows who to ask for.";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) errs.email = suggestion ? `That email looks unfinished — did you mean ${suggestion}?` : "That email looks unfinished.";
    if (!/^\d{5}$/.test(zip.trim())) errs.zip = "A 5-digit ZIP code.";
    else if (!isBergenZip(zip.trim())) { errs.zip = `${zip.trim()} is outside Bergen County. We're Bergen-only for now — we'll save your email and tell you when we expand.`; setOutside(true); }
    setErrors(errs);
    if (Object.keys(errs).length) return;

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

  // Same three fields, then Google instead of a code. The finish route
  // registers the ZIP and referral once Google sends the browser back.
  async function google() {
    const errs: typeof errors = {};
    if (!name.trim()) errs.name = "Your name, so the contractor knows who to ask for.";
    if (!/^\d{5}$/.test(zip.trim())) errs.zip = "A 5-digit ZIP code.";
    else if (!isBergenZip(zip.trim())) { errs.zip = `${zip.trim()} is outside Bergen County. We're Bergen-only for now.`; setOutside(true); }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const supabase = createClient();
    const finish = `/join/finish?${new URLSearchParams({ name: name.trim(), zip: zip.trim(), ...(refId ? { ref: refId } : {}), next }).toString()}`;
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
    // The profile row exists now (signup trigger). Add ZIP, town, referral.
    const { error: regErr } = await supabase.rpc("homeowner_register", {
      p_full_name: name.trim(), p_zip: zip.trim(), p_town: townForZip(zip.trim()), p_ref: refId,
    });
    if (regErr && !isMissingFunction(regErr)) console.warn("homeowner_register:", friendly(regErr.message));
    router.replace(next);
    router.refresh();
  }

  if (step === "code") {
    return (
      <Screen>
        <AppBar back={() => setStep("form")} />
        <form className="body" onSubmit={verify} noValidate>
          <div className="hero">
            <h1>Check your email.</h1>
            <p className="lead">We sent a sign-in code to <strong>{email.trim()}</strong>. It&apos;s good for five minutes. The link in the email works too.</p>
          </div>
          <label className="field">
            <span className="field-label">Code</span>
            <input className="input mono" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]*" maxLength={10}
              placeholder="12345678" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus
              style={{ fontSize: 28, letterSpacing: "0.3em", textAlign: "center", fontFamily: "var(--font-heading)" }} />
          </label>
          {errors.submit && <Notice kind="error">{errors.submit}</Notice>}
          <p className="small text-muted">Nothing arrived? Look in spam, or <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0, fontSize: 13 }} onClick={() => setStep("form")}>go back and resend</button>.</p>
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={busy || code.length < 6}>
              {busy ? <><span className="spin" /> Signing you in…</> : "Continue"}
            </button>
          </div>
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <AppBar back="/" />
      <form className="body" onSubmit={submit} noValidate>
        <div className="hero">
          <h1>Three fields. That&apos;s it.</h1>
          <p className="lead">We&apos;ll ask about your home only when a project needs it.</p>
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
          <span className="field-label">ZIP code</span>
          <input className={`input ${errors.zip ? "invalid" : ""}`} inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="07666" value={zip}
            onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setOutside(false); }} />
          {errors.zip && <p className="hint error">{errors.zip}</p>}
          {!errors.zip && isBergenZip(zip) && <p className="hint">{townForZip(zip)} — you&apos;re in.</p>}
        </label>

        <p className="small text-muted" style={{ margin: 0 }}>No address, no phone, no card. Prices are the same for everyone in the community.</p>

        {errors.submit && <Notice kind="error" title="We couldn't save that.">{errors.submit}</Notice>}

        {/* Google leads, same as the sign-in screen. It sits below the fields
            rather than above them because the name and ZIP have to be captured
            before we hand off to Google, but of the two ways in it is first. */}
        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button type="button" className="btn btn-primary btn-block" onClick={() => void google()} disabled={busy || outside}><GoogleMark /> Continue with Google</button>
          <div className="divider-label" style={{ justifyContent: "center" }}><span>or</span></div>
          <button className={`btn btn-secondary btn-block ${busy ? "busy" : ""}`} disabled={busy || outside}>
            {busy ? <><span className="spin" /> One moment…</> : errors.submit ? "Try again" : "Email me a code"}
          </button>
          <p className="small text-muted center" style={{ margin: "4px 0 0" }}>Already in? <Link href="/login">Sign in</Link></p>
        </div>
      </form>
    </Screen>
  );
}
