"use client";

import { useState } from "react";
import { saveConfigValues } from "./actions";

export type ConfigField = {
  key: string;
  label: string;
  type: "select" | "number" | "text";
  options?: string[];
  unit?: string;
};

// The generator configurator: structured parameters that price the job.
export const GENERATOR_FIELDS: ConfigField[] = [
  { key: "location", label: "Location", type: "select", options: ["Attached to house", "Detached / standalone"] },
  { key: "capacity_kw", label: "Generator capacity", type: "number", unit: "kW" },
  { key: "capacity_amps", label: "Generator capacity", type: "number", unit: "amps" },
  { key: "service_size", label: "Current electric service", type: "select", options: ["100 amp", "200 amp", "300 amp"] },
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
  const save = saveConfigValues.bind(null, projectId);

  return (
    <form action={save} onSubmit={() => setBusy(true)} style={{ display: "grid", gap: 10 }}>
      <div className="form-2col">
        {fields.map((f) => (
          <div key={f.key} className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`cfg-${f.key}`}>{f.label}{f.unit ? ` (${f.unit})` : ""}</label>
            {f.type === "select" ? (
              <select id={`cfg-${f.key}`} name={f.key} className="input" defaultValue={values[f.key] ?? ""}>
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
