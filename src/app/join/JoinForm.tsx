"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { TradeTilesGrid } from "@/components/TradeTiles";

type TradeGroup = { stage: string; trades: string[] };

const RADII = [5, 10, 25, 50, 100];

// Signup: pick what you are here for - manage your projects, deliver
// services, or both. Quick by default: a provider signs up with About-you
// plus trades; business info is completed later through the phone-verified
// second form (/vendor/complete) - or right here for whoever prefers.
export function JoinForm({ inviteToken }: { inviteToken: string | null }) {
  const router = useRouter();
  const [wantsProjects, setWantsProjects] = useState(true);
  const [wantsServices, setWantsServices] = useState(false);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  // Business info (companies columns) - shown only when they opt to add it now.
  const [addNow, setAddNow] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [dba, setDba] = useState("");
  const [license, setLicense] = useState("");
  const [website, setWebsite] = useState("");
  const [address, setAddress] = useState("");
  const [heard, setHeard] = useState("");
  const [workersComp, setWorkersComp] = useState(false);
  const [liability, setLiability] = useState(false);
  const [gcInsurance, setGcInsurance] = useState(false);

  // Service area (part of business info).
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState(25);
  const [adjacentOk, setAdjacentOk] = useState(false);

  // Trades: icon tiles for the headline trades, full catalog in the fold.
  const [groups, setGroups] = useState<TradeGroup[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [step, setStep] = useState<"form" | "code" | "done">("form");
  const [code, setCode] = useState("");
  const [vendorCode, setVendorCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    if (!wantsServices || groups.length > 0) return;
    createClient()
      .rpc("vendor_trades")
      .then(({ data }) => setGroups((data as TradeGroup[]) ?? []));
  }, [wantsServices, groups.length]);

  function toggleTrade(t: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  }

  function friendly(msg: string) {
    const m = msg.match(/^[A-Z_]+: (.*)$/);
    return m ? m[1] : msg;
  }

  const completeLink =
    typeof window !== "undefined" ? `${window.location.origin}/vendor/complete` : "/vendor/complete";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!wantsProjects && !wantsServices) {
      setError("Pick at least one: manage your projects, or deliver services.");
      return;
    }
    if (wantsServices) {
      if (!phone.trim()) return setError("A phone number is required for service providers.");
      if (picked.size === 0) return setError("Pick at least one trade.");
      if (addNow) {
        if (!companyName.trim()) return setError("Your company name is required.");
        if (!/^\d{5}$/.test(zip.trim())) return setError("Enter a 5-digit ZIP code for your service area.");
      }
    }
    setBusy(true);
    const supabase = createClient();

    if (wantsServices) {
      const { data, error: err } = await supabase.rpc("vendor_register", {
        // Quick path: the business is registered under the person's own name
        // until the second form fills the real company details.
        p_company_name: addNow ? companyName.trim() : name.trim(),
        p_contact_name: name.trim(),
        p_email: email.trim(),
        p_phone: phone.trim(),
        p_address: addNow ? address.trim() || null : null,
        p_trades: Array.from(picked),
        p_heard: addNow ? heard.trim() || null : null,
        p_license: addNow ? license.trim() || null : null,
        p_website: addNow ? website.trim() || null : null,
        p_workers_comp: addNow ? workersComp : null,
        p_liability: addNow ? liability : null,
        p_gc_insurance: addNow ? gcInsurance : null,
        p_referred_by: null,
        p_legal_name: addNow ? legalName.trim() || null : null,
        p_dba: addNow ? dba.trim() || null : null,
        p_zip: addNow ? zip.trim() : null,
        p_radius_miles: addNow ? radius : null,
        p_serves_adjacent_states: addNow ? adjacentOk : null,
      });
      if (err) {
        setBusy(false);
        setError(friendly(err.message));
        return;
      }
      setVendorCode(data?.vendor_code ?? "");
    }

    if (wantsProjects) {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: {
          shouldCreateUser: true,
          emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/my")}`,
        },
      });
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      setStep("code");
    } else {
      setBusy(false);
      setStep("done");
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    });
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    if (inviteToken) {
      // A failure here must not block the signup itself.
      await supabase.rpc("redeem_invitation", { p_token: inviteToken });
    }
    setBusy(false);
    router.push("/my");
    router.refresh();
  }

  const finishLater = vendorCode && !addNow;

  const mailBody = `Finish your Green Bergen business profile here: ${completeLink}\nWe verify you by the phone number you registered with.`;
  const completeLaterCard = (
      <div className="card" style={{ padding: "16px 20px", display: "grid", gap: 10 }}>
        <strong>Finish your business profile later</strong>
        <p className="muted small" style={{ margin: 0 }}>
          Complete it any time at the link below — we verify you by your phone
          number, so the link is safe to keep.
        </p>
        <code className="small" style={{ wordBreak: "break-all", background: "#f2f7f3", padding: "8px 10px", borderRadius: 8 }}>
          {completeLink}
        </code>
        <div className="btn-row">
          <a className="btn ghost" href={`mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent("Finish your Green Bergen business profile")}&body=${encodeURIComponent(mailBody)}`}>
            Email me the link
          </a>
          <button
            type="button" className="btn ghost"
            onClick={async () => {
              try { await navigator.clipboard.writeText(completeLink); setLinkCopied(true); } catch {}
            }}
          >
            {linkCopied ? "Copied ✓" : "Copy link"}
          </button>
          <a className="btn ghost" href="/vendor/complete">Finish now</a>
        </div>
      </div>
  );

  if (step === "done") {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ padding: "20px 22px" }}>
          <h2 style={{ marginTop: 0, fontSize: 19 }}>You&apos;re registered</h2>
          <p style={{ marginBottom: 0 }}>
            Your vendor code is <strong>{vendorCode || "on its way"}</strong>.
            We review every registration and get back to you.
          </p>
        </div>
        {finishLater ? completeLaterCard : null}
      </div>
    );
  }

  if (step === "code") {
    return (
      <div style={{ display: "grid", gap: 14 }}>
        <form onSubmit={verify} className="card" style={{ padding: "20px 22px", display: "grid", gap: 10, maxWidth: 430 }}>
          {vendorCode && (
            <p className="muted small" style={{ margin: 0 }}>
              Business registered — vendor code <strong>{vendorCode}</strong>.
            </p>
          )}
          <p style={{ margin: 0 }}>
            Check <strong>{email}</strong> for your sign-in code (valid 5 minutes).
          </p>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="join-code">Code</label>
            <input id="join-code" className="input" inputMode="numeric" required autoFocus value={code}
              onChange={(e) => setCode(e.target.value)}
              style={{ letterSpacing: "0.4em", fontSize: 18, textAlign: "center" }} />
          </div>
          {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
          <div>
            <button className="btn" disabled={busy || code.trim().length < 6}>
              {busy ? "Verifying..." : "Finish signing up"}
            </button>
          </div>
        </form>
        {finishLater ? completeLaterCard : null}
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
      {inviteToken && (
        <p className="card small" style={{ padding: "10px 14px", margin: 0 }}>
          You were invited — finishing signup will apply your invitation.
        </p>
      )}

      <div className="typecards">
        <label className={wantsProjects ? "typecard on" : "typecard"}>
          <input type="checkbox" checked={wantsProjects} onChange={(e) => setWantsProjects(e.target.checked)} />
          <strong>Manage your projects</strong>
          <span className="muted small">Your home, its jobs, the people and the money.</span>
        </label>
        <label className={wantsServices ? "typecard on" : "typecard"}>
          <input type="checkbox" checked={wantsServices} onChange={(e) => setWantsServices(e.target.checked)} />
          <strong>Deliver services</strong>
          <span className="muted small">Work with us as a contractor or supplier.</span>
        </label>
      </div>

      <div className="card" style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
        <span className="section-title" style={{ marginBottom: 0 }}>About you</span>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="join-name">Your name</label>
          <input id="join-name" className="input" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="form-2col">
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="join-email">Email (required)</label>
            <input id="join-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="join-phone">Phone {wantsServices ? "(required)" : "(recommended)"}</label>
            <input id="join-phone" className="input" type="tel" required={wantsServices} value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </div>
      </div>

      {wantsServices && (
        <>
          <div className="card" style={{ padding: "18px 20px" }}>
            <span className="section-title">Your trades — pick all that apply</span>
            <TradeTilesGrid picked={picked} onToggle={toggleTrade} />
            <details className="tradefold" style={{ marginTop: 10 }}>
              <summary>More trades</summary>
              <div>
                {groups.length === 0 && <p className="muted small">Loading trades...</p>}
                {groups.map((g) => {
                  const count = g.trades.filter((t) => picked.has(t)).length;
                  return (
                    <details key={g.stage} className="tradefold" style={{ marginLeft: 14 }}>
                      <summary>
                        {g.stage}
                        {count > 0 && <span className="tradecount">{count}</span>}
                      </summary>
                      <div className="tradelist">
                        {g.trades.map((t) => (
                          <label key={t} className="radio-opt small">
                            <input type="checkbox" checked={picked.has(t)} onChange={() => toggleTrade(t)} /> {t}
                          </label>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
            </details>
          </div>

          {!addNow && (
            <div className="card" style={{ padding: "16px 20px", display: "grid", gap: 8 }}>
              <strong>Business info will be added later</strong>
              <p className="muted small" style={{ margin: 0 }}>
                After you sign up we&apos;ll give you a link to a second form —
                verify your phone, fill in the business details, done. Prefer to
                finish everything now? You can.
              </p>
              <div>
                <button type="button" className="btn ghost" onClick={() => setAddNow(true)}>
                  Add business info now
                </button>
              </div>
            </div>
          )}

          {addNow && (
            <>
              <div className="card" style={{ padding: "18px 20px", display: "grid", gap: 10 }}>
                <span className="section-title" style={{ marginBottom: 0 }}>Your business</span>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="b-name">Company name (required)</label>
                  <input id="b-name" className="input" required value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </div>
                <div className="form-2col">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="b-legal">Legal name</label>
                    <input id="b-legal" className="input" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="b-dba">Trading name (DBA)</label>
                    <input id="b-dba" className="input" value={dba} onChange={(e) => setDba(e.target.value)} />
                  </div>
                </div>
                <div className="form-2col">
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="b-license">License number</label>
                    <input id="b-license" className="input" value={license} onChange={(e) => setLicense(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="b-web">Website</label>
                    <input id="b-web" className="input" value={website} onChange={(e) => setWebsite(e.target.value)} />
                  </div>
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="b-addr">Business address</label>
                  <input id="b-addr" className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="b-heard">How did you hear about us?</label>
                  <input id="b-heard" className="input" value={heard} onChange={(e) => setHeard(e.target.value)} />
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
                    <label htmlFor="sa-zip">ZIP code (required)</label>
                    <input id="sa-zip" className="input" inputMode="numeric" required value={zip} onChange={(e) => setZip(e.target.value)} />
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label htmlFor="sa-radius">Radius</label>
                    <div className="radio-row" style={{ gap: "6px 12px", minHeight: 0 }}>
                      {RADII.map((r) => (
                        <label key={r} className="radio-opt small">
                          <input type="radio" name="sa-radius" checked={radius === r} onChange={() => setRadius(r)} /> {r} mi
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
            </>
          )}
        </>
      )}

      {error && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      <div>
        <button className="btn" disabled={busy}>
          {busy ? "Working..." : wantsProjects ? "Continue — email me a code" : "Register my business"}
        </button>
      </div>
    </form>
  );
}
