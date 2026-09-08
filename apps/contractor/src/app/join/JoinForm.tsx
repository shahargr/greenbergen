"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { AppBar, Notice, Screen, StepKicker } from "@shared/ui";
import { GoogleMark } from "@/app/login/page";

// Three fields and a code. Everything else - trades, licence, insurance -
// comes after they are in, because a person filling in a W-9 before they
// have seen a single job is a person who closes the tab.
export function JoinForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"you" | "code">("you");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { setErr("Your name, as your customers would say it."); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { setErr("That email looks unfinished."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        data: { full_name: name.trim() },
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/join/finish")}`,
      },
    });
    setBusy(false);
    if (error) { setErr(/rate|too many/i.test(error.message) ? "Too many tries in a row. Give it a minute." : "We couldn't send the code. Check your connection and try again."); return; }
    setStep("code");
  }

  async function google() {
    if (name.trim().length < 2) { setErr("Your name first — one line, then Google."); return; }
    setBusy(true); setErr("");
    const supabase = createClient();
    // The name, company and phone ride along so /join/finish can register
    // without asking twice.
    const q = new URLSearchParams({ name: name.trim(), company: company.trim(), phone: phone.trim() });
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(`/join/finish?${q}`)}` },
    });
    if (error) { setBusy(false); setErr(/not enabled|unsupported provider/i.test(error.message) ? "Google sign-in isn't switched on for this project yet. Use the email code." : error.message); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error) { setBusy(false); setErr(/expired/i.test(error.message) ? "That code expired. Go back for a fresh one." : "That code didn't match."); return; }

    const { data, error: regErr } = await supabase.rpc("contractor_register", {
      p_full_name: name.trim(), p_company_name: company.trim() || null, p_phone: phone.trim() || null,
    });
    setBusy(false);
    if (regErr || !data?.ok) { setErr(friendly(data?.reason ?? regErr?.message)); return; }
    router.replace("/work");
    router.refresh();
  }

  return (
    <Screen>
      <AppBar back={step === "code" ? () => setStep("you") : "/"} />
      <form className="body" onSubmit={step === "you" ? send : verify} noValidate>
        <StepKicker>{step === "you" ? "Join · 1 of 2" : "Join · 2 of 2"}</StepKicker>
        <div className="hero">
          <h1>{step === "you" ? "Who are we talking to?" : "Check your email."}</h1>
          <p className="lead">
            {step === "you"
              ? "Three lines now. Trades, licence and insurance come later — you can look at the work before any of that."
              : <>A code went to <strong>{email.trim()}</strong>. Good for five minutes.</>}
          </p>
        </div>

        {step === "you" ? (
          <>
            <label className="field">
              <span className="field-label">Your name</span>
              <input className="input" autoComplete="name" placeholder="Javier Ruiz" value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} autoFocus />
            </label>
            <label className="field">
              <span className="field-label">Business name <span className="text-muted">(optional)</span></span>
              <input className="input" autoComplete="organization" placeholder="Ruiz Plumbing & Heating" value={company} onChange={(e) => setCompany(e.target.value)} />
              <p className="hint">On your own? Leave it blank and we&apos;ll use your name.</p>
            </label>
            <label className="field">
              <span className="field-label">Mobile <span className="text-muted">(optional)</span></span>
              <input className="input" type="tel" inputMode="tel" autoComplete="tel" placeholder="(201) 555-0142" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className="field">
              <span className="field-label">Email</span>
              <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder="you@example.com" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} />
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
          <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={busy || (step === "code" && code.length < 6)}>
            {busy ? <><span className="spin" /> One moment…</> : step === "you" ? "Send my code" : "Create my account"}
          </button>
          {step === "you" && (
            <>
              <div className="divider-label" style={{ justifyContent: "center" }}><span>or</span></div>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => void google()} disabled={busy}><GoogleMark /> Continue with Google</button>
            </>
          )}
          <p className="small text-muted center" style={{ margin: "4px 0 0" }}>Already here? <Link href="/login">Sign in</Link></p>
        </div>
      </form>
    </Screen>
  );
}
