"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Login = email -> emailed 6-digit code (valid 5 minutes, Supabase email OTP).
// The emailed magic link also still works (handled by /auth/confirm).
function nextPath() {
  const n = new URLSearchParams(window.location.search).get("next");
  return n && n.startsWith("/") && !n.startsWith("//") ? n : "/";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const router = useRouter();

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(nextPath())}`,
      },
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
    } else {
      setStep("code");
    }
  }

  async function googleSignIn() {
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/confirm` },
    });
    if (error) {
      setBusy(false);
      setMessage(error.message);
    }
    // on success the browser redirects to Google
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setBusy(false);
    if (error) {
      setMessage(error.message);
    } else {
      router.push(nextPath());
      router.refresh();
    }
  }

  return (
    <main className="center-page">
      <div className="card elev-md auth-card">
        <span className="card-kicker">Green Bergen</span>
        <h4 style={{ margin: 0 }}>Sign in</h4>

        {step === "email" ? (
          <>
            <p className="card-body">
              Enter your email — we&apos;ll send you a sign-in code, valid for
              5 minutes.
            </p>
            <form onSubmit={sendCode}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  className="input"
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy}>
                {busy ? "Sending..." : "Email me a code"}
              </button>
            </form>
            {process.env.NEXT_PUBLIC_GOOGLE_LOGIN === "1" && (
              <>
                <div className="hr" role="presentation" />
                <button type="button" className="btn btn-secondary btn-block" disabled={busy} onClick={googleSignIn}>
                  Continue with Google
                </button>
              </>
            )}
          </>
        ) : (
          <>
            <p className="card-body">
              Check <strong>{email}</strong> for your sign-in code (valid 5
              minutes). The emailed link works too.
            </p>
            <form onSubmit={verify}>
              <div className="field">
                <label htmlFor="code">Code</label>
                <input
                  id="code"
                  className="input"
                  inputMode="numeric"
                  required
                  autoFocus
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{ letterSpacing: "0.4em", fontSize: 18, textAlign: "center" }}
                />
              </div>
              <button className="btn btn-primary btn-block" disabled={busy || code.trim().length < 6}>
                {busy ? "Verifying..." : "Sign in"}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-block"
                onClick={() => { setStep("email"); setCode(""); setMessage(""); }}
              >
                Use a different email
              </button>
            </form>
          </>
        )}

        {message && (
          <p className="card-meta" style={{ color: "#d98a8a" }}>{message}</p>
        )}
        <Link href="/" className="btn btn-ghost btn-block">← Back to home</Link>
      </div>
    </main>
  );
}
