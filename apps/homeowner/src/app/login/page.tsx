"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { createClient } from "@shared/supabase/client";
import { AppBar, Notice, Screen } from "@shared/ui";

// Returning members: email, then the code from the email (8 digits today;
// the field takes 6 to 10). Same OTP as /join.
function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/project";
  const linkError = params.get("error") === "link";
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(linkError ? "That sign-in link has expired or was already used. Enter your email and we'll send a fresh code." : "");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("That email looks unfinished."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) { setErr(/rate|too many/i.test(error.message) ? "Too many tries in a row. Give it a minute." : "We couldn't send the code. Check your connection and try again."); return; }
    setStep("code");
  }

  async function google() {
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    if (error) { setBusy(false); setErr(/not enabled|unsupported provider/i.test(error.message) ? "Google sign-in isn't switched on for this project yet. Use the email code." : error.message); }
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
      <AppBar back={step === "code" ? () => setStep("email") : "/"} />
      <form className="body" onSubmit={step === "email" ? send : verify} noValidate>
        <div className="hero">
          <h1>{step === "email" ? "Welcome back." : "Check your email."}</h1>
          <p className="lead">{step === "email" ? "Your email, and we'll send a sign-in code. No password to remember." : <>A sign-in code went to <strong>{email.trim()}</strong>. Good for five minutes.</>}</p>
        </div>
        {step === "email" ? (
          <label className="field">
            <span className="field-label">Email</span>
            <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </label>
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
          <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={busy || (step === "code" && code.length < 6)}>
            {busy ? <><span className="spin" /> One moment…</> : step === "email" ? "Send my code" : "Sign in"}
          </button>
          {step === "email" && (
            <>
              <div className="divider-label" style={{ justifyContent: "center" }}><span>or</span></div>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => void google()} disabled={busy}><GoogleMark /> Continue with Google</button>
            </>
          )}
          <p className="small text-muted center" style={{ margin: "4px 0 0" }}>New here? <Link href="/join">Join the community</Link></p>
        </div>
      </form>
    </Screen>
  );
}

export const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6C12.3 13.4 17.7 9.5 24 9.5z" /><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z" /><path fill="#FBBC05" d="M10.4 28.8A14.5 14.5 0 0 1 9.5 24c0-1.7.3-3.3.8-4.8l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.8l7.8-6z" /><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-3.9-13.6-9.6l-7.8 6C6.5 42.6 14.6 48 24 48z" /></svg>
);

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
