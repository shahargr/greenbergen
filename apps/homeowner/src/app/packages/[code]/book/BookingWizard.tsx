"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { configLabel, depositCents, priceFor, type Package, type Selections } from "@/lib/catalogue";
import { dollars, shortDate } from "@/lib/format";
import { friendly, isMissingFunction } from "@/lib/rpc";
import { AppBar, Blueprint, CheckIcon, Notice, Screen, StatusHero, StepKicker } from "@/components/ui";

// One client-side wizard, so the photos a homeowner takes stay in memory
// across steps and upload only after the booking row exists (the storage
// path must start with the job's project id). Steps: address -> facts ->
// photos -> budget -> booked.

type Geo = { ok: boolean; found?: boolean; matched?: string; county?: string | null; bergen?: boolean | null; city?: string | null };
type Facts = { sqft: string; year_built: string; beds: string; baths: string };
type Shot = { file: File; preview: string; state: "ready" | "uploading" | "done" | "failed"; progress: number; error?: string };
type Step = "address" | "facts" | "photos" | "budget" | "booked";

const BUDGET_BANDS = (price: number | null) => {
  const p = price ?? 0;
  const lo = Math.floor(p / 50000) * 50000; // $500 steps
  const b = (c: number) => `$${Math.round(c / 100).toLocaleString()}`;
  return [
    { key: "under", label: `Under ${b(lo)}`, hint: "We'd suggest changes" },
    { key: "fits", label: `${b(lo)} – ${b(lo + 50000)}`, hint: null, tag: "Fits this package" },
    { key: "more", label: `${b(lo + 50000)} – ${b(lo + 150000)}`, hint: "Room for a step up" },
    { key: "skip", label: "I'd rather not say", hint: null },
  ];
};

export function BookingWizard({ pkg, selections, knownAddress, knownFacts, dbReady }: {
  pkg: Package; selections: Selections; knownAddress: string | null; knownFacts: Record<string, string | number> | null; dbReady: boolean;
}) {
  const router = useRouter();
  const price = priceFor(pkg, selections);
  const deposit = depositCents(pkg, price);
  const [step, setStep] = useState<Step>("address");
  const [address, setAddress] = useState(knownAddress ?? "");
  const [unit, setUnit] = useState("");
  const [geo, setGeo] = useState<Geo | null>(null);
  const [checking, setChecking] = useState(false);
  const [facts, setFacts] = useState<Facts>({
    sqft: String(knownFacts?.sqft ?? ""), year_built: String(knownFacts?.year_built ?? ""), beds: String(knownFacts?.beds ?? ""), baths: String(knownFacts?.baths ?? ""),
  });
  const [shots, setShots] = useState<Record<string, Shot | undefined>>({});
  const [budget, setBudget] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ project_id: string; reply_by: string; offered_count: number; instant_book: boolean; price_cents: number } | null>(null);
  const [uploadIssues, setUploadIssues] = useState<string[]>([]);

  // ---- address ----------------------------------------------------------
  async function checkAddress(e: React.FormEvent) {
    e.preventDefault();
    if (address.trim().length < 6) { setErr("The street address, town and ZIP."); return; }
    setErr(""); setChecking(true);
    try {
      const res = await fetch(`/api/geocode?q=${encodeURIComponent(address.trim())}`);
      const g = (await res.json()) as Geo;
      setGeo(g);
      if (g.ok && g.found && g.bergen === false) {
        setErr(`That's ${g.county ?? "outside Bergen County"}. We're Bergen-only for now — we'll email you when we expand.`);
        setChecking(false);
        return;
      }
      if (g.ok && g.found && g.matched) setAddress(titleCase(g.matched));
    } catch {
      setGeo({ ok: false });
    }
    setChecking(false);
    setStep("facts");
  }

  // ---- photos -----------------------------------------------------------
  function take(key: string, file: File | null | undefined) {
    if (!file) return;
    setShots((s) => {
      const prev = s[key]; if (prev) URL.revokeObjectURL(prev.preview);
      return { ...s, [key]: { file, preview: URL.createObjectURL(file), state: "ready", progress: 0 } };
    });
  }
  const shotCount = pkg.photos.filter((p) => shots[p.key]).length;
  const required = Math.min(pkg.photos.length, 1); // at least the first photo; the rest are encouraged
  const photosOk = shotCount >= required;

  // ---- book -------------------------------------------------------------
  async function book() {
    setErr(""); setBusy("Booking…");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("homeowner_book", {
      p_code: pkg.code, p_selections: selections, p_address: address.trim(), p_unit: unit.trim() || null,
      p_facts: { ...cleanFacts(facts), source: geo?.found ? "census-geocoder + owner" : "owner" },
      p_budget_band: budget && budget !== "skip" ? BUDGET_BANDS(price).find((b) => b.key === budget)?.label ?? budget : null,
      p_note: note.trim() || null,
    });
    if (error) {
      setBusy("");
      setErr(isMissingFunction(error) ? "Booking isn't switched on in the database yet (the migration in db/ has not been applied). Nothing was sent." : friendly(error.message));
      return;
    }
    if (!data?.ok) { setBusy(""); setErr(friendly(data?.reason)); return; }
    const projectId = data.project_id as string;

    // Photos go straight to Storage under the job's id, then are recorded.
    const issues: string[] = [];
    for (const req of pkg.photos) {
      const shot = shots[req.key];
      if (!shot) continue;
      setBusy(`Uploading ${req.label.toLowerCase()}…`);
      setShots((s) => ({ ...s, [req.key]: { ...shot, state: "uploading", progress: 30 } }));
      const { path, ext } = storagePath(projectId, req.key, shot.file.name);
      const { error: upErr } = await supabase.storage.from("project-media").upload(path, shot.file, { contentType: shot.file.type || undefined });
      if (upErr) { issues.push(`${req.label}: ${upErr.message}`); setShots((s) => ({ ...s, [req.key]: { ...shot, state: "failed", progress: 0, error: upErr.message } })); continue; }
      const { error: recErr } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: shot.file.name || `${req.key}${ext}`, p_mime: shot.file.type || "image/jpeg",
        p_size: shot.file.size, p_caption: req.label, p_kind: "photo",
      });
      if (recErr) { issues.push(`${req.label}: ${friendly(recErr.message)}`); setShots((s) => ({ ...s, [req.key]: { ...shot, state: "failed", progress: 0, error: recErr.message } })); continue; }
      setShots((s) => ({ ...s, [req.key]: { ...shot, state: "done", progress: 100 } }));
    }
    setUploadIssues(issues);
    setResult({ project_id: projectId, reply_by: data.reply_by, offered_count: data.offered_count, instant_book: data.instant_book, price_cents: data.price_cents });
    setBusy("");
    setStep("booked");
    router.refresh();
  }

  // ---- screens ----------------------------------------------------------
  if (step === "booked" && result) {
    const kicker = `${result.instant_book ? "Booked" : "Requested"} · ${shortDate(new Date().toISOString())}`;
    return (
      <Screen>
        <AppBar brand />
        <div className="body">
          {result.instant_book ? (
            <StatusHero variant="solid" kicker={kicker} title={`Your ${pkg.tile_title.toLowerCase()} job is out to the community's ${tradePlural(pkg.trade)}.`}>
              First to accept at {dollars(result.price_cents)} gets it. No bidding, no haggling — that&apos;s the point.
            </StatusHero>
          ) : (
            <StatusHero variant="outline" kicker={kicker} title={`Your ${pkg.tile_title.toLowerCase()} is in. A contractor will confirm the details first.`}>
              {pkg.approval_note}
            </StatusHero>
          )}
          <Blueprint pad>
            {result.instant_book ? (
              <ul className="scope">
                <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Matching takes at least 24 hours.</strong><br /><span className="text-muted">We&apos;ll email you the moment someone accepts.</span></span></li>
                <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Nothing charged today.</strong><br /><span className="text-muted">{pkg.requires_permit ? `${pkg.permit_deposit_pct}% is due at the permit meeting, paid to your contractor.` : "You pay your contractor when the work is done."}</span></span></li>
              </ul>
            ) : (
              <div className="kv-rows">
                <div><span className="k">Your estimate</span><span>{dollars(result.price_cents)} · {configLabel(pkg, selections)}</span></div>
                <div><span className="k">Status</span><span className="tag tag-accent">Awaiting contractor approval</span></div>
                <div><span className="k">Expect an answer</span><span>within 24–48 h</span></div>
              </div>
            )}
          </Blueprint>
          {result.offered_count === 0 && (
            <Notice title="Heads up">No contractor for this trade is signed in to the community yet, so the job waits for one. A person at Green Bergen sees every booking and will bring one in.</Notice>
          )}
          {uploadIssues.length > 0 && (
            <Notice kind="error" title="Booked, but a photo didn't attach.">{uploadIssues.join("; ")}. You can add photos from the job folder.</Notice>
          )}
        </div>
        <div className="actions">
          <Link href={`/project/${result.project_id}`} className="btn btn-primary btn-block blueprint">See my project</Link>
          <Link href="/packages" className="btn btn-ghost btn-block">Back to packages</Link>
        </div>
      </Screen>
    );
  }

  if (step === "address") {
    return (
      <Screen>
        <AppBar back={`/packages/${pkg.code}`} />
        <form className="body" onSubmit={checkAddress} noValidate>
          <StepKicker>Step 2 of 3 · Your home</StepKicker>
          <div className="hero">
            <h1>Where&apos;s the {pkg.tile_title.toLowerCase()} going?</h1>
            <p className="lead">We need the address now for the price{pkg.requires_permit ? " and the town permit" : ""}. Contractors see it only after they accept.</p>
          </div>
          <label className="field">
            <span className="field-label">Street address</span>
            <input className={`input ${err ? "invalid" : ""}`} autoComplete="street-address" placeholder="14 Elm St, Teaneck, NJ 07666" value={address} onChange={(e) => { setAddress(e.target.value); setErr(""); }} autoFocus />
            <p className="hint">Bergen County only. Checked against public records on the next step.</p>
          </label>
          {err && <Notice kind="error">{err}</Notice>}
          {!dbReady && <Notice title="Preview mode">The database migration for bookings has not been applied yet, so this walk-through ends at the Book button.</Notice>}
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className={`btn btn-primary btn-block blueprint ${checking ? "busy" : ""}`} disabled={checking}>{checking ? <><span className="spin" /> Checking the address…</> : "Continue"}</button>
          </div>
        </form>
      </Screen>
    );
  }

  if (step === "facts") {
    const found = !!geo?.found;
    return (
      <Screen>
        <AppBar back={() => setStep("address")} />
        <form className="body" onSubmit={(e) => { e.preventDefault(); setStep("photos"); }} noValidate>
          <StepKicker>Step 2 of 3 · Your home</StepKicker>
          <div className="hero">
            <h1>{found ? "Here's what we found." : "We couldn't look this one up."}</h1>
            <p className="lead">{found ? "Public records match this address. Rough numbers for the house are enough — the contractor confirms on site." : "Happens with newer builds and some condos. Rough numbers are fine — the contractor confirms on site."}</p>
          </div>
          <Blueprint pad={false}>
            <div className="facts-head">
              <div className="addr">{address.split(",")[0]}</div>
              <div className="small text-muted">{address.split(",").slice(1).join(",").trim()}</div>
            </div>
            <div className="facts">
              <FactInput label="Living area" unit="sq ft" value={facts.sqft} onChange={(v) => setFacts({ ...facts, sqft: v })} placeholder="approx." />
              <FactInput label="Year built" value={facts.year_built} onChange={(v) => setFacts({ ...facts, year_built: v })} placeholder="not sure is fine" />
              <FactInput label="Bedrooms" value={facts.beds} onChange={(v) => setFacts({ ...facts, beds: v })} placeholder="3" />
              <FactInput label="Bathrooms" value={facts.baths} onChange={(v) => setFacts({ ...facts, baths: v })} placeholder="2" />
            </div>
          </Blueprint>
          <label className="field">
            <span className="field-label">Apartment or unit <span className="text-muted">(optional)</span></span>
            <input className="input" placeholder="—" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <p className="tiny text-muted" style={{ margin: 0 }}>Property-record lookup (size, year, rooms) is coming; for now what you type is what the contractor sees.</p>
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block blueprint">{found ? "Looks right" : "Continue"}</button>
            <button type="button" className="btn btn-ghost btn-block" onClick={() => setStep("photos")}>Skip — I&apos;ll tell the contractor</button>
          </div>
        </form>
      </Screen>
    );
  }

  if (step === "photos") {
    const n = pkg.photos.length;
    const words = ["", "One photo", "Two photos", "Three photos", "Four photos"];
    return (
      <Screen>
        <AppBar back={() => setStep("facts")} />
        <div className="body">
          <StepKicker>Step 2 of 3 · Your home</StepKicker>
          <div className="hero">
            <h1>{n === 1 ? "One photo, and the contractor can confirm the price." : n === 3 ? `Three photos for a ${pkg.tile_title.toLowerCase()}.` : `${words[n] ?? n} and the contractor can confirm the price.`}</h1>
            <p className="lead">{pkg.code === "generator" ? "Don't know your panel's amperage or gas line size? You don't need to — the photo answers it." : "Phone photos are perfect. Nobody's judging the basement."}</p>
          </div>
          {pkg.photos.map((req, i) => <PhotoSlot key={req.key} index={i + 1} label={req.label} hint={req.hint} shot={shots[req.key]} onPick={(f) => take(req.key, f)} />)}
          <p className="small text-muted" style={{ margin: 0 }}>Photos go into your job folder. Only the contractor who accepts your job sees them.</p>
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block blueprint" disabled={!photosOk} onClick={() => setStep("budget")}>
              Continue · {shotCount} of {n} added
            </button>
            {!photosOk && <p className="tiny text-muted center" style={{ margin: 0 }}>At least the first photo — it&apos;s what lets a contractor say yes without a visit.</p>}
          </div>
        </div>
      </Screen>
    );
  }

  // budget
  const bands = BUDGET_BANDS(price);
  return (
    <Screen>
      <AppBar back={() => setStep("photos")} right={<button type="button" className="btn btn-ghost" onClick={() => { setBudget("skip"); void book(); }} disabled={!!busy}>Skip</button>} />
      <div className="body">
        <StepKicker>Step 3 of 3 · Optional</StepKicker>
        <div className="hero">
          <h1>How much would you like to spend?</h1>
          <p className="lead">Totally optional. If we know, we can suggest a smarter approach — a smaller tank, a different fuel, a phased job.</p>
        </div>
        <div className="stack" style={{ gap: 8 }}>
          {bands.map((b) => (
            <label className="choice" key={b.key}>
              <span className="radio"><input type="radio" name="budget" checked={budget === b.key} onChange={() => setBudget(b.key)} /><span className="dot" /></span>
              <span className="txt">{b.label}{b.hint && <small>{b.hint}</small>}</span>
              {b.tag && <span className="tag tag-accent">{b.tag}</span>}
            </label>
          ))}
        </div>
        <label className="field">
          <span className="field-label">Anything the contractor should know? <span className="text-muted">(optional)</span></span>
          <textarea className="input" rows={2} placeholder={pkg.code === "driveway" ? "Measurements if you have them, gate codes, a dog…" : "Gate code, a dog, best time to come…"} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <p className="small text-muted" style={{ margin: 0 }}>Never shown to contractors. It doesn&apos;t change the price — the community already set that.</p>
        {err && <Notice kind="error" title="That didn't go through.">{err}</Notice>}
        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className={`btn btn-primary btn-block blueprint ${busy ? "busy" : ""}`} disabled={!!busy} onClick={() => void book()}>
            {busy ? <><span className="spin" /> {busy}</> : pkg.instant_book ? `Book at ${dollars(price)}` : `Request at ${dollars(price)}`}
          </button>
          {!busy && <p className="tiny text-muted center" style={{ margin: 0 }}>{pkg.requires_permit ? `Nothing today. ${dollars(deposit)} at the permit meeting, to the contractor.` : "Nothing today. You pay the contractor when it's done."}</p>}
        </div>
      </div>
    </Screen>
  );
}

function FactInput({ label, unit, value, onChange, placeholder }: { label: string; unit?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <div className="k">{label}</div>
      <div className="v" style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
        <input className="input" inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))} placeholder={placeholder}
          style={{ padding: "2px 0", minHeight: 0, border: 0, borderBottom: "1px solid var(--color-divider)", background: "transparent", fontFamily: "var(--font-heading)", fontWeight: 600, fontSize: 22, width: unit ? 90 : 110 }} />
        {unit && <small>{unit}</small>}
      </div>
    </div>
  );
}

// PhotoSlot - empty, captured, uploading, failed.
function PhotoSlot({ index, label, hint, shot, onPick }: { index: number; label: string; hint: string | null; shot?: Shot; onPick: (f: File | null | undefined) => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.preview); }, [shot]);
  return (
    <div className={`slot ${shot?.state === "failed" ? "failed" : ""}`}>
      <div className="head">
        <div className="n">{index} · {label}</div>
        {shot && shot.state !== "uploading" && <button type="button" className="btn btn-ghost" onClick={() => cam.current?.click()}>Retake</button>}
      </div>
      {shot ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="thumb" src={shot.preview} alt={label} />
          {shot.state === "uploading" && <><div className="bar"><span style={{ width: `${shot.progress}%` }} /></div><div className="small text-muted">Uploading…</div></>}
          {shot.state === "failed" && <div className="small" style={{ color: "var(--color-danger)" }}><strong>Upload failed</strong> — {shot.error ?? "you went offline"}. The photo is still on your phone.</div>}
          {shot.state === "ready" && <div className="small text-muted">Added just now · {shot.file.name}</div>}
          {shot.state === "done" && <div className="small text-muted">In your folder ✓</div>}
        </>
      ) : (
        <>
          {hint && <div className="small text-muted">{hint}</div>}
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => cam.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Camera
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => lib.current?.click()}>Library</button>
          </div>
        </>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

// Module-level so the render-purity lint leaves the clock alone.
const storagePath = (projectId: string, key: string, fileName: string) => {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
  return { path: `${projectId}/photos/${Date.now()}-${key}${ext}`, ext };
};
const cleanFacts = (f: Facts) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(f)) if (v && /^\d+$/.test(v)) out[k] = Number(v);
  return out;
};
const titleCase = (s: string) => s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bNj\b/, "NJ");
const tradePlural = (trade: string | null) => {
  switch (trade) {
    case "Plumbing": return "plumbers";
    case "Electrical": return "electricians";
    case "Painting": return "painters";
    case "Gutters": return "gutter crews";
    case "Hardscaping": return "paving contractors";
    case "Decks": return "fence and deck builders";
    default: return "contractors";
  }
};
