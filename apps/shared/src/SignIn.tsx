"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "./supabase/client";
import { AppBar, Notice, Screen } from "./ui";

// ONE sign-in screen for all four doors.
//
// It was three near-identical files - homeowner, contractor, builder - that
// differed in the default landing path and one footer line, and nothing else.
// Three copies of an auth flow is three places to fix a bug and three places
// for the button order to drift apart, which is exactly what happened: the
// portal put Google first and the three apps buried it under the email code.
//
// GOOGLE LEADS, at Shahar's direction, and it is the right way round anyway.
// One tap versus leave-the-app-read-an-email-come-back-type-eight-digits: the
// code path is the fallback for people who have no Google account or do not
// want to use it, and a fallback should not be the first thing offered.
//
// Same Supabase Auth behind both, and the same app_users row either way - the
// choice here is only how you prove it is you.
export function SignIn({ home, footer, title = "Welcome back." }: {
  home: string;
  footer?: React.ReactNode;
  title?: string;
}) {
  return <Suspense fallback={null}><SignInInner home={home} footer={footer} title={title} /></Suspense>;
}

function SignInInner({ home, footer, title }: { home: string; footer?: React.ReactNode; title: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  // Only our own paths, never an absolute URL someone pasted into ?next=.
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : home;
  const linkError = params.get("error") === "link";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"start" | "code">("start");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(linkError ? "That sign-in link has expired or was already used. Enter your email and we'll send a fresh code." : "");

  const redirectTo = () => `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`;

  async function google() {
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    // On success the browser leaves for Google, so there is nothing to reset.
    if (error) {
      setBusy(false);
      setErr(/not enabled|unsupported provider/i.test(error.message)
        ? "Google sign-in isn't switched on for this project yet. Use the email code below."
        : error.message);
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("That email looks unfinished."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: redirectTo() } });
    setBusy(false);
    if (error) { setErr(/rate|too many/i.test(error.message) ? "Too many tries in a row. Give it a minute." : "We couldn't send the code. Check your connection and try again."); return; }
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) { setBusy(false); setErr(/expired/i.test(error.message) ? "That code expired. Go back for a fresh one." : "That code didn't match."); return; }
    router.replace(next);
    router.refresh();
  }

  return (
    <Screen>
      <AppBar back={step === "code" ? () => setStep("start") : "/"} />
      <form className="body" onSubmit={step === "start" ? send : verify} noValidate>
        <div className="hero">
          <h1>{step === "start" ? title : "Check your email."}</h1>
          <p className="lead">
            {step === "start"
              ? "One tap with Google, or your email and we'll send a code. No password either way."
              : <>A sign-in code went to <strong>{email.trim()}</strong>. Good for five minutes.</>}
          </p>
        </div>

        {step === "start" ? (
          <>
            <button type="button" className="btn btn-primary btn-block" onClick={() => void google()} disabled={busy}>
              <GoogleMark /> Continue with Google
            </button>
            <div className="divider-label" style={{ justifyContent: "center" }}><span>or</span></div>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
                placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          </>
        ) : (
          <label className="field">
            <span className="field-label">Code</span>
            <input className="input mono" inputMode="numeric" autoComplete="one-time-code" maxLength={10} placeholder="12345678" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus
              style={{ fontSize: 28, letterSpacing: "0.3em", textAlign: "center", fontFamily: "var(--font-heading)" }} />
          </label>
        )}

        {err && <Notice kind="error">{err}</Notice>}

        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          {/* The submit button. On the first step it is the SECONDARY act now
              that Google leads, so it is styled to match its place. */}
          <button className={`btn ${step === "start" ? "btn-secondary" : "btn-primary"} btn-block ${busy ? "busy" : ""}`}
            disabled={busy || (step === "code" && code.length < 6)}>
            {busy ? <><span className="spin" /> One moment…</> : step === "start" ? "Send my code" : "Sign in"}
          </button>
          {footer && <p className="small text-muted center" style={{ margin: "4px 0 0" }}>{footer}</p>}
        </div>
      </form>
    </Screen>
  );
}

export const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" /><path fill="#FBBC05" d="M10.4 28.8A14.5 14.5 0 0 1 9.5 24c0-1.7.3-3.3.8-4.8l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-3.9-13.6-9.6l-7.8 6C6.5 42.6 14.6 48 24 48z" /></svg>
);
