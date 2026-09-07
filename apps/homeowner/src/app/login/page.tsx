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
          <p className="small text-muted center" style={{ margin: "4px 0 0" }}>New here? <Link href="/join">Join the community</Link></p>
        </div>
      </form>
    </Screen>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginInner /></Suspense>;
}
