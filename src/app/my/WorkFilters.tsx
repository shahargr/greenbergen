"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type Bucket = "active" | "lead" | "decision" | "payment" | "done" | "all";

export const BUCKETS: { key: Bucket; label: string; hint: string }[] = [
  { key: "active",   label: "Active",              hint: "Open projects you are on" },
  { key: "lead",     label: "Leads",               hint: "Invited to bid, not answered" },
  { key: "decision", label: "Pending bid decision", hint: "You bid; the owner is deciding" },
  { key: "payment",  label: "Pending payment",     hint: "Booked to you, not yet paid" },
  { key: "done",     label: "Completed",           hint: "Closed projects" },
  { key: "all",      label: "Everything",          hint: "Every project you touch" },
];

type Slot = { label: string; bucket: Bucket };
const DEFAULTS: Slot[] = [
  { label: "Leads", bucket: "lead" },
  { label: "Pending bid decision", bucket: "decision" },
  { label: "Pending payment", bucket: "payment" },
  { label: "Completed", bucket: "done" },
];

// Four filters over your work, the same shape as the ones on a project's task
// list: click to apply, the cog to point a slot somewhere else and rename it.
// Active is not a slot — it is where the page starts.
export function WorkFilters({ view, counts }: { view: Bucket; counts: Record<string, number> }) {
  const router = useRouter();
  const [slots, setSlots] = useState<Slot[]>(DEFAULTS);
  const [setup, setSetup] = useState<number | null>(null);
  const [draft, setDraft] = useState<Slot>(DEFAULTS[0]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("gb_work_slots");
      if (raw) {
        const v = JSON.parse(raw);
        // eslint-disable-next-line react-hooks/set-state-in-effect
        if (Array.isArray(v) && v.length === 4) setSlots(v);
      }
    } catch {}
  }, []);
  const persist = (next: Slot[]) => {
    setSlots(next);
    try { localStorage.setItem("gb_work_slots", JSON.stringify(next)); } catch {}
  };
  const go = (b: Bucket) => router.push(b === "active" ? "/my" : `/my?view=${b}`);
  const open = (i: number) => { setDraft(slots[i]); setSetup(setup === i ? null : i); };
  const save = () => {
    if (setup === null) return;
    const next = [...slots];
    next[setup] = { label: draft.label.trim() || BUCKETS.find((b) => b.key === draft.bucket)!.label, bucket: draft.bucket };
    persist(next);
    setSetup(null);
  };

  return (
    <div style={{ display: "grid", gap: 6, margin: "0 0 10px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 6 }}>
        <button type="button" className={view === "active" ? "btn small" : "btn ghost small"}
          onClick={() => go("active")} title="Open projects you are on">
          Active {counts.active ? <strong>· {counts.active}</strong> : null}
        </button>
        {slots.map((sl, i) => (
          <span key={i} style={{ display: "flex", alignItems: "stretch", minWidth: 0 }}>
            <button type="button"
              className={view === sl.bucket ? "btn small" : "btn ghost small"}
              onClick={() => go(sl.bucket)}
              title={BUCKETS.find((b) => b.key === sl.bucket)?.hint}
              style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                       borderTopRightRadius: 0, borderBottomRightRadius: 0, padding: "4px 6px", fontSize: 11 }}>
              {sl.label}{counts[sl.bucket] ? <strong> · {counts[sl.bucket]}</strong> : null}
            </button>
            <button type="button" className="btn ghost small" aria-label={`Set up filter ${i + 1}`}
              title="Point this filter somewhere else"
              onClick={() => open(i)}
              style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 0, padding: "2px 6px", flex: "none" }}>
              ⚙
            </button>
          </span>
        ))}
      </div>

      {setup !== null && (
        <div className="card" style={{ display: "grid", gap: 8, padding: "10px 12px" }}>
          <div className="small" style={{ fontWeight: 700 }}>Filter {setup + 1}</div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="wf-bucket">Show</label>
            <select id="wf-bucket" className="input" value={draft.bucket}
              onChange={(e) => {
                const bucket = e.target.value as Bucket;
                const preset = BUCKETS.find((b) => b.key === bucket)!;
                setDraft((d) => ({ bucket, label: d.label && d.label !== BUCKETS.find((x) => x.key === d.bucket)?.label ? d.label : preset.label }));
              }}>
              {BUCKETS.filter((b) => b.key !== "active").map((b) => (
                <option key={b.key} value={b.key}>{b.label} — {b.hint}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="wf-name">Button name</label>
            <input id="wf-name" className="input" value={draft.label} style={{ maxWidth: 260 }}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn small" onClick={save}>Save filter {setup + 1}</button>
            <button type="button" className="btn ghost small" onClick={() => { persist(DEFAULTS); setSetup(null); }}>Reset all four</button>
            <button type="button" className="btn ghost small" onClick={() => setSetup(null)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
