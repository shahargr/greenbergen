import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { saveActivity, saveStep, moveStep, deleteStep } from "../actions";

export const dynamic = "force-dynamic";

// ONE PROCESS, STEP BY STEP. The steps of a package in the order they
// actually happen, each one naming the TRADE whose hand it needs (187) -
// the generator's gas diagram is the plumber's, the jacket is the
// electrician's, and adding up what the house burns is ours. Before 187 that
// was a free-text "assignee" holding things like "Contracto" and "Zoe", which
// is why nobody could answer "which steps does the plumber own".
//
// A step also carries the explanation somebody follows on site, and 187 lets
// a step be marked hidden from the owner - the homeowner's step-by-step
// (homeowner_package_process) drops those, so an internal note never has to
// live somewhere else.
type Step = {
  id: string; step_name: string; step_order: number; notes: string | null;
  photo_url: string | null; trade: string | null; default_assigned_to: string | null;
  action_type: string | null; is_gate: boolean; necessity: string | null;
  asks: string | null; decides: string | null; answers: string[] | null;
  only_if: Record<string, string> | null; hidden_from_owner: boolean; cadence: string | null;
};
type Process = {
  id: string; name: string; description: string | null; domain: string | null;
  is_active: boolean; can_edit: boolean; in_flight: number;
  packages: { code: string; name: string }[] | null;
  facts: { decides: string; answers: string[] }[] | null;
  steps: Step[];
};

const ACTIONS = ["backoffice", "build", "financial transaction", "visual inspection"];
const NECESSITY = ["required", "recommended", "optional"];

export default async function ActivityPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string; ok?: string }>;
}) {
  const { id } = await params;
  const { error, saved } = await searchParams;
  const supabase = await createClient();

  const [{ data }, { data: trades }, { data: domains }] = await Promise.all([
    supabase.rpc("portal_process", { p_blueprint: id }),
    supabase.from("trades").select("trade").order("sort_order"),
    supabase.from("domains").select("name").eq("is_active", true).order("name"),
  ]);
  if (!data) notFound();
  const p = data as Process;
  const tradeList = (trades ?? []).map((t) => t.trade as string);
  // Every fact an earlier step decides, so "only if" is a pick rather than a
  // remembered key. A step can only depend on something already answered.
  const facts = p.facts ?? [];

  return (
    <main>
      <p className="small"><Link href="/admin/activities">&larr; All activities</Link></p>
      <span className="kicker">
        Process · {p.domain ?? "no domain"}
        {p.in_flight > 0 && ` · running on ${p.in_flight} ${p.in_flight === 1 ? "job" : "jobs"}`}
      </span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>{p.name}</h1>
      {p.packages && p.packages.length > 0 && (
        <p className="muted small" style={{ margin: "0 0 10px" }}>
          Behind{" "}
          {p.packages.map((k, i) => (
            <span key={k.code}>
              {i > 0 && ", "}
              <Link href={`/admin/packages/${k.code}`}>{k.name}</Link>
            </span>
          ))}
        </p>
      )}

      {error && <p className="card" style={{ borderLeft: "4px solid var(--danger)" }}>{error}</p>}
      {saved && <p className="card" style={{ borderLeft: "4px solid var(--brand)" }}>{saved}</p>}

      {/* 1. WHAT THIS PROCESS IS */}
      <div className="card" id="process">
        <h2 className="section-title">What it is</h2>
        <form action={saveActivity} className="pk-row first">
          <input type="hidden" name="id" value={p.id} />
          <label className="pk-f wide"><span>Name</span>
            <input className="input" name="name" defaultValue={p.name} required /></label>
          <label className="pk-f"><span>Domain</span>
            <select className="input" name="domain" defaultValue={p.domain ?? "construction"}>
              {(domains ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
            </select></label>
          <label className="pk-f narrow" style={{ alignSelf: "end" }}>
            <span className="sr-only">Still run</span>
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="checkbox" name="is_active" defaultChecked={p.is_active} /> We still run it
            </span></label>
          <label className="pk-f full"><span>What it is for</span>
            <textarea className="input" name="description" rows={3} defaultValue={p.description ?? ""} /></label>
          <div className="pk-acts" style={{ justifyContent: "flex-end" }}><button className="btn">Save</button></div>
        </form>
      </div>

      {/* 2. THE STEPS, IN ORDER */}
      <div className="card" id="steps">
        <h2 className="section-title">The steps, in the order they happen</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each step names the trade whose hand it needs, or leaves it with us. The explanation is what
          somebody reads standing in front of the work - write it for them, not for the file. A step marked
          <em> ours only</em> is kept out of the homeowner&rsquo;s step-by-step.
        </p>

        {p.steps.length === 0 && <p className="muted small">No steps yet. Add the first one below.</p>}

        {p.steps.map((st, i) => (
          <details key={st.id} id={st.id} className="act-step" open={p.steps.length <= 3}>
            <summary>
              <span className="act-n">{st.step_order}</span>
              <span className="act-name">{st.step_name}</span>
              <span className="act-tags">
                <span className="chip">{st.trade ?? "us"}</span>
                {st.is_gate && <span className="chip warn">gate</span>}
                {st.only_if && <span className="chip">only if {Object.entries(st.only_if).map(([k, v]) => `${k} = ${v}`).join(", ")}</span>}
                {st.decides && <span className="chip">decides {st.decides}</span>}
                {st.hidden_from_owner && <span className="chip">ours only</span>}
                {st.necessity && st.necessity !== "required" && <span className="chip">{st.necessity}</span>}
              </span>
            </summary>

            <form action={saveStep} className="pk-row">
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="step" value={st.id} />
              <label className="pk-f wide"><span>Step</span>
                <input className="input" name="name" defaultValue={st.step_name} required /></label>
              <label className="pk-f"><span>Whose hand</span>
                <select className="input" name="trade" defaultValue={st.trade ?? "us"}>
                  <option value="us">Us - nobody hired</option>
                  {tradeList.map((t) => <option key={t} value={t}>{t}</option>)}
                </select></label>
              <label className="pk-f"><span>Kind of work</span>
                <select className="input" name="action_type" defaultValue={st.action_type ?? ""}>
                  <option value="">—</option>
                  {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select></label>
              <label className="pk-f narrow"><span>Need</span>
                <select className="input" name="necessity" defaultValue={st.necessity ?? "required"}>
                  {NECESSITY.map((v) => <option key={v} value={v}>{v}</option>)}
                </select></label>
              <label className="pk-f full"><span>What somebody needs to know</span>
                <textarea className="input" name="notes" rows={5} defaultValue={st.notes ?? ""} /></label>
              <label className="pk-f wide"><span>What it asks for when it is done</span>
                <input className="input" name="asks" defaultValue={st.asks ?? ""} placeholder="Permit number and the date it was filed" /></label>
              <label className="pk-f"><span>Photograph (URL)</span>
                <input className="input" name="photo_url" defaultValue={st.photo_url ?? ""} /></label>
              <label className="pk-f"><span>It decides</span>
                <input className="input" name="decides" defaultValue={st.decides ?? ""} placeholder="meter_ok" /></label>
              <label className="pk-f"><span>Its answers</span>
                <input className="input" name="answers" defaultValue={(st.answers ?? []).join(", ")} placeholder="yes, no" /></label>
              <label className="pk-f"><span>Only if</span>
                <select className="input" name="only_if_key" defaultValue={st.only_if ? Object.keys(st.only_if)[0] : ""}>
                  <option value="">Always</option>
                  {facts.map((f) => <option key={f.decides} value={f.decides}>{f.decides}</option>)}
                </select></label>
              <label className="pk-f narrow"><span>is</span>
                <input className="input" name="only_if_value" defaultValue={st.only_if ? Object.values(st.only_if)[0] : ""} placeholder="no" /></label>
              <label className="pk-f wide" style={{ alignSelf: "end" }}>
                <span className="sr-only">Flags</span>
                <span style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" name="is_gate" defaultChecked={st.is_gate} /> Nothing below moves until it passes
                  </span>
                  <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="checkbox" name="hidden_from_owner" defaultChecked={st.hidden_from_owner} /> Ours only
                  </span>
                </span></label>
              <div className="pk-acts" style={{ justifyContent: "flex-end" }}>
                {/* Moving and removing are the same form pointed elsewhere (HTML
                    forbids a form inside a form), and they skip validation: you
                    are not saving the fields, so an empty one must not stop you. */}
                <button formAction={moveStep} formNoValidate name="move" value={`${st.id}:up`} className="btn ghost"
                  disabled={i === 0} title="Earlier" aria-label="Move earlier">↑</button>
                <button formAction={moveStep} formNoValidate name="move" value={`${st.id}:down`} className="btn ghost"
                  disabled={i === p.steps.length - 1} title="Later" aria-label="Move later">↓</button>
                <button formAction={deleteStep} formNoValidate name="delete" value={st.id} className="btn ghost"
                  title="Remove the step" aria-label="Remove the step">✕</button>
                <button className="btn">Save the step</button>
              </div>
            </form>
          </details>
        ))}
      </div>

      {/* 3. ONE MORE STEP, AT THE END */}
      <div className="card" id="new">
        <h2 className="section-title">Another step</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          It lands at the end; move it up from there. The explanation is not optional — a step nobody can
          follow is worse than no step.
        </p>
        <form action={saveStep} className="pk-row first">
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="step" value="" />
          <label className="pk-f wide"><span>Step</span>
            <input className="input" name="name" required placeholder="Call the inspection" /></label>
          <label className="pk-f"><span>Whose hand</span>
            <select className="input" name="trade" defaultValue="us">
              <option value="us">Us - nobody hired</option>
              {tradeList.map((t) => <option key={t} value={t}>{t}</option>)}
            </select></label>
          <label className="pk-f"><span>Kind of work</span>
            <select className="input" name="action_type" defaultValue="backoffice">
              {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select></label>
          <label className="pk-f narrow"><span>Need</span>
            <select className="input" name="necessity" defaultValue="required">
              {NECESSITY.map((v) => <option key={v} value={v}>{v}</option>)}
            </select></label>
          <label className="pk-f full"><span>What somebody needs to know</span>
            <textarea className="input" name="notes" rows={4} required
              placeholder="Book a working day ahead. It can fail, and when it does this step comes round again." /></label>
          <label className="pk-f wide"><span>What it asks for when it is done</span>
            <input className="input" name="asks" placeholder="Which inspections, when, and what was written up" /></label>
          <label className="pk-f wide" style={{ alignSelf: "end" }}>
            <span className="sr-only">Flags</span>
            <span style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="is_gate" /> Nothing below moves until it passes
              </span>
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="checkbox" name="hidden_from_owner" /> Ours only
              </span>
            </span></label>
          <div className="pk-acts" style={{ justifyContent: "flex-end" }}><button className="btn">Add it</button></div>
        </form>
      </div>
    </main>
  );
}
