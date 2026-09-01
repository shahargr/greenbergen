"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

const RADII = [5, 10, 25, 50, 100];

// The second form: a registered vendor completes their business profile.
// Identity is proven by phone code (vendor_request_code_public /
// vendor_verify_code), which yields a 30-minute session token that
// vendor_update_profile requires. Every field is optional - blank leaves the
// stored value alone.
export function CompleteForm() {
  const [step, setStep] = useState<"identify" | "code" | "form" | "done">("identify");
  const [identifier, setIdentifier] = useState("");
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");

  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [dba, setDba] = useState("");
  const [license, setLicense] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [workersComp, setWorkersComp] = useState(false);
  const [liability, setLiability] = useState(false);
  const [gcInsurance, setGcInsurance] = useState(false);
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState(25);
  const [adjacentOk, setAdjacentOk] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function friendly(msg: string) {
    const m = msg.match(/^[A-Z_]+: (.*)$/);
    return m ? m[1] : msg;
  }

  async function requestCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("vendor_request_code_public", {
      p_identifier: identifier.trim(),
    });
    setBusy(false);
    if (err || data?.ok === false) {
      setError(friendly(err?.message ?? data?.message ?? "Could not find that registration."));
      return;
    }
    setVerificationId(data?.verification_id ?? data?.id ?? "");
    setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("vendor_verify_code", {
      p_verification_id: verificationId,
      p_code: code.trim(),
    });
    setBusy(false);
    if (err || !data?.ok) {
      setError(friendly(err?.message ?? data?.message ?? "That code does not match."));
      return;
    }
    setToken(data?.session_token ?? data?.token ?? "");
    setStep("form");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("vendor_update_profile", {
      p_token: token,
      p_contact_name: null,
      p_email: null,
      p_address: address.trim() || null,
      p_license: license.trim() || null,
      p_website: website.trim() || null,
      p_workers_comp: workersComp || null,
      p_liability: liability || null,
      p_gc_insurance: gcInsurance || null,
      p_add_trades: null,
      p_company_name: companyName.trim() || null,
      p_legal_name: legalName.trim() || null,
      p_dba: dba.trim() || null,
      p_zip: zip.trim() || null,
      p_radius_miles: zip.trim() ? radius : null,
      p_serves_adjacent_states: zip.trim() ? adjacentOk : null,
    });
    setBusy(false);
    if (err || data?.ok === false) {
      setError(friendly(err?.message ?? "Could not save — try again."));
      return;
    }
    setStep("done");
  }

  if (step === "done") {
    return (
      <div className="card" style={{ padding: "20px 22px" }}>
        <h2 style={{ marginTop: 0, fontSize: 19 }}>Profile updated</h2>
        <p style={{ marginBottom: 0 }}>
          Thank you — your business details are on file and go into our review.
        </p>
      </div>
    );
  }

  if (step === "identify") {
    return (
      <form onSubmit={requestCode} className="card" style={{ padding: "20px 22px", display: "grid", gap: 10, maxWidth: 430 }}>
        <p style={{ margin: 0 }}>
          Enter the <strong>phone number</strong> (or vendor code) you
          registered with — we&apos;ll verify it with a code.
        </p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="vc-id">Phone or vendor code</label>
          <input id="vc-id" className="input" required autoFocus value={identifier}
            onChange={(e) => setIdentifier(e.target.value)} />
        </div>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
        <div>
          <button className="btn" disabled={busy}>{busy ? "Checking..." : "Send me a code"}</button>
        </div>
      </form>
    );
  }

  if (step === "code") {
    return (
      <form onSubmit={verify} className="card" style={{ padding: "20px 22px", display: "grid", gap: 10, maxWidth: 430 }}>
        <p style={{ margin: 0 }}>Enter the verification code (valid 5 minutes).</p>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="vc-code">Code</label>
          <input id="vc-code" className="input" inputMode="numeric" required autoFocus value={code}
            onChange={(e) => setCode(e.target.value)}
            style={{ letterSpacing: "0.4em", fontSize: 18, textAlign: "center" }} />
        </div>
        {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
        <div>
          <button className="btn" disabled={busy}>{busy ? "Verifying..." : "Verify"}</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={save} style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Your business</span>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="c-name">Company name</label>
          <input id="c-name" className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </div>
        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-legal">Legal name</label>
            <input id="c-legal" className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-dba">Trading name (DBA)</label>
            <input id="c-dba" className="input" value={dba} onChange={(e) => setDba(e.target.value)} />
          </div>
        </div>
        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-license">License number</label>
            <input id="c-license" className="input" value={license} onChange={(e) => setLicense(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-web">Website</label>
            <input id="c-web" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="c-addr">Business address</label>
          <input id="c-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div className="radio-legend">Insurance you can provide</div>
        <div className="radio-row" style={{ minHeight: 0 }}>
          <label className="radio-opt"><input type="checkbox" checked={workersComp} onChange={(e) => setWorkersComp(e.target.checked)} /> Workers&apos; comp</label>
          <label className="radio-opt"><input type="checkbox" checked={liability} onChange={(e) => setLiability(e.target.checked)} /> Liability</label>
          <label className="radio-opt"><input type="checkbox" checked={gcInsurance} onChange={(e) => setGcInsurance(e.target.checked)} /> New-house GC</label>
        </div>
      </div>

      <div className="card" style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Service area</span>
        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-zip">ZIP code</label>
            <input id="c-zip" className="input" inputMode="numeric" value={zip} onChange={(e) => setZip(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="c-radius">Radius</label>
            <div className="radio-row" style={{ gap: "6px 12px", minHeight: 0 }}>
              {RADII.map((r) => (
                <label key={r} className="radio-opt small">
                  <input type="radio" name="c-radius" checked={radius === r} onChange={() => setRadius(r)} /> {r} mi
                </label>
              ))}
            </div>
          </div>
        </div>
        <label className="radio-opt">
          <input type="checkbox" checked={adjacentOk} onChange={(e) => setAdjacentOk(e.target.checked)} />
          I&apos;m OK serving across the state line where my radius reaches
        </label>
      </div>

      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      <div>
        <button className="btn" disabled={busy}>{busy ? "Saving..." : "Save my profile"}</button>
      </div>
    </form>
  );
}
