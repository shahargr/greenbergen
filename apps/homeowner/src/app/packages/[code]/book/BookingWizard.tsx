"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { configLabel, depositCents, priceFor, type Package, type Selections } from "@shared/catalogue";
import { dollars, shortDate } from "@shared/format";
import { friendly, isMissingFunction } from "@shared/rpc";
import { AppBar, Card, CheckIcon, Notice, Screen, StatusHero, StepKicker } from "@shared/ui";
import { HouseIcon } from "@shared/ui";
import { PhotoRequest } from "@/components/PhotoRequest";
import { TARGET_WINDOWS, targetWindowLabel, type TargetWindow } from "@/lib/plan";
import type { Home, HomeQuota } from "@/lib/me";

// One client-side wizard, so the photos a homeowner takes stay in memory
// across steps and upload only after the booking row exists (the storage
// path must start with the job's project id).
//   book:  home -> (address) -> facts -> photos -> budget -> booked
//          the facts step is SKIPPED when we already know the house (the
//          member told us on an earlier job); the photos step says so and
//          links back if anything changed.
//   plan:  home -> (address) -> when -> planned          (nothing sent)
//   post:  facts -> photos -> budget -> booked            (a plan, ordered)
// "home" appears only when the member already has one or more homes.

type Geo = { ok: boolean; found?: boolean; matched?: string; county?: string | null; bergen?: boolean | null; city?: string | null };
type Facts = { sqft: string; year_built: string; beds: string; baths: string };
type Shot = { file: File; preview: string; state: "ready" | "uploading" | "done" | "failed"; progress: number; error?: string };
type Step = "home" | "address" | "facts" | "photos" | "budget" | "when" | "booked";
export type WizardMode = "book" | "plan" | "post";

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

export function BookingWizard({ pkg, selections, mode, planned, homes, quota, knownAddress, knownFacts, dbReady }: {
  pkg: Package; selections: Selections; mode: WizardMode;
  planned: { project_id: string; address: string | null; target_window: TargetWindow | null } | null;
  homes: Home[]; quota: HomeQuota; knownAddress: string | null; knownFacts: Record<string, string | number> | null; dbReady: boolean;
}) {
  const router = useRouter();
  const price = priceFor(pkg, selections);
  const deposit = depositCents(pkg, price);
  const hasHomes = homes.length > 0;
  const knownHouse = told(knownFacts);
  const [step, setStep] = useState<Step>(mode === "post" ? (knownHouse ? "photos" : "facts") : hasHomes ? "home" : "address");
  const [reusedFacts, setReusedFacts] = useState(mode === "post" && knownHouse);
  const [homeId, setHomeId] = useState<string | null>(hasHomes ? homes[0]!.project_id : null);
  const [address, setAddress] = useState(planned?.address ?? knownAddress ?? "");
  const [unit, setUnit] = useState("");
  const [geo, setGeo] = useState<Geo | null>(null);
  const [checking, setChecking] = useState(false);
  const [facts, setFacts] = useState<Facts>({
    sqft: String(knownFacts?.sqft ?? ""), year_built: String(knownFacts?.year_built ?? ""), beds: String(knownFacts?.beds ?? ""), baths: String(knownFacts?.baths ?? ""),
  });
  const [shots, setShots] = useState<Record<string, Shot | undefined>>({});
  const [budget, setBudget] = useState<string>("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState<TargetWindow>(planned?.target_window ?? "1_3_months");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ project_id: string; reply_by: string; offered_count: number; instant_book: boolean; price_cents: number; planned?: boolean } | null>(null);
  const [uploadIssues, setUploadIssues] = useState<string[]>([]);
  const afterHome: Step = mode === "plan" ? "when" : "facts";
  const stepLabel = mode === "plan" ? "DIY project" : "Step 2 of 3 · Your home";

  // ---- which home --------------------------------------------------------
  function chooseHome(e: React.FormEvent) {
    e.preventDefault();
    if (homeId === "new") { setAddress(""); setGeo(null); setErr(""); setStep("address"); return; }
    const h = homes.find((x) => x.project_id === homeId);
    if (!h) { setErr("Pick a home."); return; }
    setAddress(h.address ?? "");
    // Already told us about this house? Take what we have and skip the step.
    const f = (h.facts ?? null) as Record<string, string | number> | null;
    const known = told(f);
    if (known) setFacts({ sqft: String(f?.sqft ?? ""), year_built: String(f?.year_built ?? ""), beds: String(f?.beds ?? ""), baths: String(f?.baths ?? "") });
    setReusedFacts(known);
    setErr("");
    setStep(afterHome === "facts" && known ? "photos" : afterHome);
  }

  // ---- address (a new home) ---------------------------------------------
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
    setStep(afterHome);
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
  // Nothing here blocks the booking. Photos let a contractor confirm the
  // price without a visit, but demanding them at the last step turns away
  // everyone who isn't standing in the room - and they have already agreed
  // the price by then. Booking first secures that price; the ones still
  // missing become a request in the inbox (homeowner_post_internal).
  // Still wanted: never taken, or taken and the upload did not land.
  const missingSlots = pkg.photos.filter((p) => !shots[p.key] || shots[p.key]!.state === "failed");

  // ---- plan (nothing sent) ----------------------------------------------
  async function plan() {
    setErr(""); setBusy("Saving…");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("homeowner_book", {
      p_code: pkg.code, p_selections: selections, p_address: homeId && homeId !== "new" ? null : address.trim(), p_unit: null,
      p_facts: null, p_budget_band: null, p_note: note.trim() || null,
      p_home_project_id: homeId && homeId !== "new" ? homeId : null, p_mode: "plan", p_target_window: when,
    });
    if (error) {
      setBusy("");
      setErr(isMissingFunction(error) ? "Planning isn't switched on in the database yet (the migration in db/ has not been applied). Nothing was saved." : friendly(error.message));
      return;
    }
    if (!data?.ok) { setBusy(""); setErr(friendly(data?.reason)); return; }
    setResult({ project_id: data.project_id as string, reply_by: "", offered_count: 0, instant_book: pkg.instant_book, price_cents: data.price_cents, planned: true });
    setBusy("");
    setStep("booked");
    router.refresh();
  }

  // ---- book (or post a plan) --------------------------------------------
  async function book() {
    setErr(""); setBusy(mode === "post" ? "Posting…" : "Booking…");
    const supabase = createClient();
    const { data, error } = mode === "post" && planned
      ? await supabase.rpc("homeowner_booking_action", { p_project: planned.project_id, p_action: "post" })
      : await supabase.rpc("homeowner_book", {
          p_code: pkg.code, p_selections: selections, p_address: homeId && homeId !== "new" ? null : address.trim(), p_unit: unit.trim() || null,
          p_facts: { ...cleanFacts(facts), source: geo?.found ? "census-geocoder + owner" : "owner" },
          p_budget_band: budget && budget !== "skip" ? BUDGET_BANDS(price).find((b) => b.key === budget)?.label ?? budget : null,
          p_note: note.trim() || null,
          p_home_project_id: homeId && homeId !== "new" ? homeId : null, p_mode: "book", p_target_window: null,
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
      // homeowner_photo_add keys the file to this slot and closes the photo
      // request the moment the last one lands.
      const { data: added, error: recErr } = await supabase.rpc("homeowner_photo_add", {
        p_project: projectId, p_path: path, p_key: req.key, p_file_name: shot.file.name || `${req.key}${ext}`,
        p_mime: shot.file.type || "image/jpeg", p_size: shot.file.size,
      });
      if (recErr || !added?.ok) { const m = friendly(added?.reason ?? recErr?.message); issues.push(`${req.label}: ${m}`); setShots((s) => ({ ...s, [req.key]: { ...shot, state: "failed", progress: 0, error: m } })); continue; }
      setShots((s) => ({ ...s, [req.key]: { ...shot, state: "done", progress: 100 } }));
    }
    setUploadIssues(issues);
    setResult({ project_id: projectId, reply_by: data.reply_by, offered_count: data.offered_count, instant_book: data.instant_book, price_cents: data.price_cents });
    setBusy("");
    setStep("booked");
    router.refresh();
  }

  // ---- screens ----------------------------------------------------------
  if (step === "booked" && result?.planned) {
    return (
      <Screen>
        <AppBar brand />
        <div className="body">
          <StatusHero variant="outline" kicker={`DIY · ${targetWindowLabel(when)}`} title={`Your ${pkg.tile_title.toLowerCase()} is in your DIY projects for ${address.split(",")[0] || "your home"}.`}>
            Yours to do, at your pace. Nothing was sent to anyone. Change your mind and one tap makes it turn-key, at that day&apos;s community price.
          </StatusHero>
          <Card pad>
            <div className="kv-rows">
              <div><span className="k">Your reference price</span><span>{dollars(result.price_cents)} · {configLabel(pkg, selections)}</span></div>
              <div><span className="k">When</span><span>{targetWindowLabel(when)}</span></div>
              <div><span className="k">Sent to contractors</span><span>Not yet</span></div>
            </div>
          </Card>
        </div>
        <div className="actions">
          <Link href={`/project/${result.project_id}`} className="btn btn-primary btn-block">See the plan</Link>
          <Link href="/packages" className="btn btn-ghost btn-block">Plan something else</Link>
        </div>
      </Screen>
    );
  }

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
          <Card pad>
            {result.instant_book ? (
              <ul className="scope">
                <li><span className="ic"><CheckIcon size={18} /></span><span><strong>First to take it gets it, at this price.</strong><br /><span className="text-muted">No deadline and no auction. We&apos;ll tell you the moment someone accepts.</span></span></li>
                <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Nothing charged today.</strong><br /><span className="text-muted">{pkg.requires_permit ? `${pkg.permit_deposit_pct}% is due at the permit meeting, paid to your contractor.` : "You pay your contractor when the work is done."}</span></span></li>
              </ul>
            ) : (
              <div className="kv-rows">
                <div><span className="k">Your estimate</span><span>{dollars(result.price_cents)} · {configLabel(pkg, selections)}</span></div>
                <div><span className="k">Status</span><span className="tag tag-accent">Awaiting contractor approval</span></div>
                <div><span className="k">Expect an answer</span><span>within 24–48 h</span></div>
              </div>
            )}
          </Card>
          {result.offered_count === 0 && (
            <Notice title="Heads up">No contractor for this trade is signed in to the community yet, so the job waits for one. A person at Green Bergen sees every booking and will bring one in.</Notice>
          )}
          {uploadIssues.length > 0 && (
            <Notice kind="error" title="Booked, but a photo didn&apos;t attach.">{uploadIssues.join("; ")}. Add it again below or from the job folder — nothing else is affected.</Notice>
          )}
          {/* The photos we still want. The job is already out; this is what
              lets the contractor confirm the price without coming to look. */}
          {missingSlots.length > 0 && (
            <Card pad>
              <div className="card-title" style={{ fontSize: 16 }}>{missingSlots.length === 1 ? "One photo left" : `${missingSlots.length} photos left`}</div>
              <p className="small text-muted" style={{ margin: "2px 0 10px" }}>
                Add {missingSlots.length === 1 ? "it" : "them"} whenever you&apos;re next near the work — today, tonight, tomorrow. Your price doesn&apos;t move. Until then the request waits in your inbox, and the contractor confirms once they&apos;re in.
              </p>
              <PhotoRequest projectId={result.project_id} slots={missingSlots.map((p) => ({ key: p.key, label: p.label, hint: p.hint, file_id: null }))} />
            </Card>
          )}
        </div>
        <div className="actions">
          <Link href={`/project/${result.project_id}`} className="btn btn-primary btn-block">See my project</Link>
          <Link href="/packages" className="btn btn-ghost btn-block">Back to packages</Link>
        </div>
      </Screen>
    );
  }

  if (step === "home") {
    const canAdd = quota?.can_add ?? true;
    return (
      <Screen>
        <AppBar back={`/packages/${pkg.code}`} />
        <form className="body" onSubmit={chooseHome} noValidate>
          <StepKicker>{stepLabel}</StepKicker>
          <div className="hero">
            <h1>Which home is the {pkg.tile_title.toLowerCase()} for?</h1>
            <p className="lead">{mode === "plan" ? "It goes on that home's list." : `Contractors see the address only after they accept${pkg.requires_permit ? "; the town permit is filed against it" : ""}.`}</p>
          </div>
          <div className="homes">
            {homes.map((h) => (
              <label className="home-row" key={h.project_id}>
                <input type="radio" name="home" checked={homeId === h.project_id} onChange={() => setHomeId(h.project_id)} />
                <span className="ic"><HouseIcon /></span>
                <span className="grow">
                  <span className="t">{h.address?.split(",")[0] ?? h.name ?? "Home"}</span>
                  <span className="m" style={{ display: "block" }}>{h.address?.split(",").slice(1).join(",").trim() || h.town || ""}{homeSummary(h)}</span>
                </span>
                <span className="radio"><span className="dot" /></span>
              </label>
            ))}
            <label className={`home-row add ${canAdd ? "" : "disabled"}`} style={canAdd ? undefined : { opacity: 0.6 }}>
              <input type="radio" name="home" checked={homeId === "new"} onChange={() => canAdd && setHomeId("new")} disabled={!canAdd} />
              <span className="ic">+</span>
              <span className="grow">
                <span className="t">Another address</span>
                <span className="m" style={{ display: "block" }}>{canAdd ? "A second home, a rental, a parent's place." : `Your agreement covers ${quota?.allowed ?? 1} home${(quota?.allowed ?? 1) === 1 ? "" : "s"}. Ask us to extend it.`}</span>
              </span>
              <span className="radio"><span className="dot" /></span>
            </label>
          </div>
          {err && <Notice kind="error">{err}</Notice>}
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block">Continue</button>
          </div>
        </form>
      </Screen>
    );
  }

  if (step === "address") {
    return (
      <Screen>
        <AppBar back={hasHomes ? () => setStep("home") : `/packages/${pkg.code}`} />
        <form className="body" onSubmit={checkAddress} noValidate>
          <StepKicker>{stepLabel}</StepKicker>
          <div className="hero">
            <h1>{hasHomes ? "Where's the other home?" : `Where's the ${pkg.tile_title.toLowerCase()} going?`}</h1>
            <p className="lead">{mode === "plan" ? "We add the home to your account; the plan goes on it." : `We need the address now for the price${pkg.requires_permit ? " and the town permit" : ""}. Contractors see it only after they accept.`}</p>
          </div>
          <label className="field">
            <span className="field-label">Street address</span>
            <input className={`input ${err ? "invalid" : ""}`} autoComplete="street-address" placeholder="14 Elm St, Teaneck, NJ 07666" value={address} onChange={(e) => { setAddress(e.target.value); setErr(""); }} autoFocus />
            <p className="hint">Bergen County only. Checked against public records on the next step.</p>
          </label>
          {err && <Notice kind="error">{err}</Notice>}
          {!dbReady && <Notice title="Preview mode">The database migration for bookings has not been applied yet, so this walk-through ends at the last button.</Notice>}
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className={`btn btn-primary btn-block  ${checking ? "busy" : ""}`} disabled={checking}>{checking ? <><span className="spin" /> Checking the address…</> : "Continue"}</button>
          </div>
        </form>
      </Screen>
    );
  }

  if (step === "when") {
    return (
      <Screen>
        <AppBar back={() => setStep(homeId === "new" || !hasHomes ? "address" : "home")} />
        <div className="body">
          <StepKicker>DIY project · {address.split(",")[0]}</StepKicker>
          <div className="hero">
            <h1>When do you have in mind?</h1>
            <p className="lead">Roughly is fine. It orders your list and tells us when a nudge is welcome — nobody is held to it.</p>
          </div>
          <div className="stack" style={{ gap: 8 }}>
            {TARGET_WINDOWS.map((t) => (
              <label className="choice" key={t.key}>
                <span className="radio"><input type="radio" name="when" checked={when === t.key} onChange={() => setWhen(t.key)} /><span className="dot" /></span>
                <span className="txt">{t.label}<small>{t.hint}</small></span>
              </label>
            ))}
          </div>
          <label className="field">
            <span className="field-label">A note to yourself <span className="text-muted">(optional)</span></span>
            <textarea className="input" rows={2} placeholder="Guest bath first. Ask about the 40-gallon option." value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {err && <Notice kind="error" title="That didn't save.">{err}</Notice>}
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            {/* The price is a REFERENCE, never a charge - and a button reading
                "Save the plan · $2,180 today" says the opposite of that. It
                names the action; the number stays a note beneath it. */}
            <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={!!busy} onClick={() => void plan()}>
              {busy ? <><span className="spin" /> {busy}</> : "Add to my DIY projects"}
            </button>
            {!busy && (
              <p className="tiny text-muted center" style={{ margin: 0 }}>
                Nothing charged, nothing sent to contractors. {dollars(price)} is today&apos;s community
                price, kept as your reference — switch to turn-key whenever you want and you book at
                the price of that day.
              </p>
            )}
          </div>
        </div>
      </Screen>
    );
  }

  if (step === "facts") {
    const found = !!geo?.found;
    return (
      <Screen>
        <AppBar back={mode === "post" ? `/project/${planned?.project_id}` : () => setStep(homeId === "new" || !hasHomes ? "address" : "home")} />
        <form className="body" onSubmit={(e) => { e.preventDefault(); setStep("photos"); }} noValidate>
          <StepKicker>{stepLabel}</StepKicker>
          <div className="hero">
            <h1>{found ? "Here's what we found." : geo ? "We couldn't look this one up." : "A few things about the house."}</h1>
            <p className="lead">{found ? "Public records match this address. Rough numbers for the house are enough — the contractor confirms on site." : geo ? "Happens with newer builds and some condos. Rough numbers are fine — the contractor confirms on site." : "Rough numbers are fine — the contractor confirms on site."}</p>
          </div>
          <Card pad={false}>
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
          </Card>
          <label className="field">
            <span className="field-label">Apartment or unit <span className="text-muted">(optional)</span></span>
            <input className="input" placeholder="—" value={unit} onChange={(e) => setUnit(e.target.value)} />
          </label>
          <p className="tiny text-muted" style={{ margin: 0 }}>Property-record lookup (size, year, rooms) is coming; for now what you type is what the contractor sees.</p>
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block">{found ? "Looks right" : "Continue"}</button>
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
          <StepKicker>{stepLabel}</StepKicker>
          <div className="hero">
            <h1>{n === 1 ? "One photo, whenever you're near it." : `${words[n] ?? n}, whenever you're near them.`}</h1>
            <p className="lead">{pkg.code === "generator" ? "Don't know your panel's amperage or gas line size? You don't need to — the photo answers it. Not at home? Book now and send them later." : "Phone photos are perfect, and nobody's judging the basement. Not at home? Book now and send them later — the price is locked either way."}</p>
          </div>
          {reusedFacts && (
            <Card soft pad>
              <div className="small">Using the details you gave us for {address.split(",")[0]}: {factLine(facts)}. <button type="button" className="btn btn-ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => { setReusedFacts(false); setStep("facts"); }}>Change them</button></div>
            </Card>
          )}
          {pkg.photos.map((req, i) => <PhotoSlot key={req.key} index={i + 1} label={req.label} hint={req.hint} shot={shots[req.key]} onPick={(f) => take(req.key, f)} />)}
          <p className="small text-muted" style={{ margin: 0 }}>Photos go into your job folder. Only the contractor who accepts your job sees them.</p>
          <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
            <button className="btn btn-primary btn-block" onClick={() => setStep("budget")}>
              {shotCount === 0 ? "Not home — I'll add them after" : `Continue · ${shotCount} of ${n} added`}
            </button>
            <p className="tiny text-muted center" style={{ margin: 0 }}>
              {shotCount === 0
                ? "Booking now locks today's price. We'll ask for the photos in your inbox, and the contractor confirms once they're there."
                : shotCount < n
                  ? `${n - shotCount} still to come — we'll ask for ${n - shotCount === 1 ? "it" : "them"} after you book.`
                  : "That's all of them."}
            </p>
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
          <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={!!busy} onClick={() => void book()}>
            {busy ? <><span className="spin" /> {busy}</> : mode === "post" ? `Post it at ${dollars(price)}` : pkg.instant_book ? `Book at ${dollars(price)}` : `Request at ${dollars(price)}`}
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
// Have we been told about this house before? Size or year is enough to
// skip the step; the contractor confirms on site either way.
const told = (f: Record<string, string | number> | null | undefined) =>
  !!f && (!!f.sqft || !!f.year_built || !!f.beds || !!f.baths);
const factLine = (f: Facts) =>
  [f.sqft && `${Number(f.sqft).toLocaleString()} sq ft`, f.year_built && `built ${f.year_built}`, f.beds && `${f.beds} bed`, f.baths && `${f.baths} bath`].filter(Boolean).join(", ") || "what you told us";
const homeSummary = (h: Home) => {
  const bits: string[] = [];
  if (h.live) bits.push(`${h.live} live`);
  if (h.planned) bits.push(`${h.planned} planned`);
  if (h.done) bits.push(`${h.done} done`);
  return bits.length ? ` · ${bits.join(", ")}` : "";
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
