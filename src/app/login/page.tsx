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

const MailIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m4 12.5 5 5L20 7" />
  </svg>
);

const BackIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24">
    <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.81z" />
    <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.86-3c-1.07.72-2.44 1.15-4.08 1.15-3.13 0-5.78-2.12-6.73-4.96H1.28v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56v-3.1H1.28a12 12 0 0 0 0 10.76l3.99-3.1z" />
    <path fill="#EA4335" d="M12 4.76c1.76 0 3.34.6 4.59 1.8l3.42-3.42A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.28 6.62l3.99 3.1C6.22 6.88 8.87 4.76 12 4.76z" />
  </svg>
);

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
      <div className="card auth-card">
        <span className="kicker">Green Bergen</span>
        <h1 className="auth-title">Sign in</h1>

        {step === "email" ? (
          <>
            <button type="button" className="btn google-btn" disabled={busy} onClick={googleSignIn}>
              <GoogleIcon /> Continue with Google
            </button>
            <div className="divider" role="presentation"><span>or</span></div>
            <p className="muted auth-note">
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
              <div className="btn-row">
                <button className="btn" disabled={busy}>
                  <MailIcon /> {busy ? "Sending..." : "Email me a code"}
                </button>
                <Link href="/" className="btn ghost">
                  <HomeIcon /> Back to home
                </Link>
              </div>
            </form>
          </>
        ) : (
          <>
            <p className="muted auth-note">
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
              <div className="btn-row">
                <button className="btn" disabled={busy || code.trim().length < 6}>
                  <CheckIcon /> {busy ? "Verifying..." : "Sign in"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => { setStep("email"); setCode(""); setMessage(""); }}
                >
                  <BackIcon /> Different email
                </button>
              </div>
            </form>
          </>
        )}

        {message && <p className="error small">{message}</p>}
      </div>
    </main>
  );
}
