"use client";

import { useState } from "react";
import { saveConfigValues } from "./actions";

export type ConfigField = {
  key: string;
  label: string;
  type: "select" | "number" | "text";
  options?: string[];
  unit?: string;
  // Ask this only when an earlier answer says so.
  showIf?: { key: string; equals: string };
};

// The generator configurator: structured parameters that price the job.
export const GENERATOR_FIELDS: ConfigField[] = [
  { key: "location", label: "Location", type: "select", options: ["Attached to house", "Detached / standalone"] },
  { key: "capacity_kw", label: "Generator capacity", type: "number", unit: "kW" },
  { key: "capacity_amps", label: "Generator capacity", type: "number", unit: "amps" },
  // "Not sure" is an answer the wizard offers, so the configurator has to be
  // able to show it back — and to ask the question that follows from it.
  { key: "service_size", label: "Current electric service", type: "select", options: ["100 amp", "200 amp", "300 amp", "Not sure"] },
  { key: "ac_units", label: "How many AC units in the house?", type: "number",
    showIf: { key: "service_size", equals: "Not sure" } },
  { key: "gas_distance_ft", label: "Distance from gas line", type: "number", unit: "ft" },
  { key: "gas_line_size", label: "Size of gas line", type: "select", options: ['1/2"', '3/4"', '1"', '1-1/4"', '1-1/2"', '2"'] },
  { key: "panel_distance_ft", label: "Distance from electrical panel", type: "number", unit: "ft" },
  { key: "routing", label: "Wires & gas pipe routing", type: "select", options: ["In-ground", "Above-ground", "Mixed"] },
];

export function ConfiguratorForm({
  projectId,
  fields,
  values,
}: {
  projectId: string;
  fields: ConfigField[];
  values: Record<string, string>;
}) {
  const [busy, setBusy] = useState(false);
  // The answers as they stand, so a conditional question appears at once.
  const [answers, setAnswers] = useState<Record<string, string>>(values);
  const save = saveConfigValues.bind(null, projectId);

  return (
    <form action={save} onSubmit={() => setBusy(true)} style={{ display: "grid", gap: 10 }}>
      <div className="form-2col">
        {fields.filter((f) => !f.showIf || answers[f.showIf.key] === f.showIf.equals).map((f) => (
          <div key={f.key} className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`cfg-${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ""}</label>
            {/* The label travels with the answer: a spec reads "Generator
                capacity" to a bidder, not "capacity kw". */}
            <input type="hidden" name={`label__${f.key}`} value={f.unit ? `${f.label} (${f.unit})` : f.label} />
            {f.type === "select" ? (
              <select id={`cfg-${f.key}`} name={f.key} className="input" defaultValue={values[f.key] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}>
                <option value="">—</option>
                {f.options!.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : (
              <input id={`cfg-${f.key}`} name={f.key} className="input"
                inputMode={f.type === "number" ? "decimal" : undefined}
                defaultValue={values[f.key] ?? ""} autoComplete="off" />
            )}
          </div>
        ))}
      </div>
      <div>
        <button className="btn" disabled={busy}>{busy ? "Saving..." : "Save configuration"}</button>
      </div>
    </form>
  );
}
