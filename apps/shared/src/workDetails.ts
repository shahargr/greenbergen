// WHAT THE HOMEOWNER TOLD US ABOUT THE WORK (migrations 237-238). The EV
// charger's booking asks where it goes, the car, the run from the panel, the
// amperage and the subpanel (apps/homeowner lib/ev.ts) and keeps them as
// project_bookings.facts.ev. The crew reads them as work_details - on the
// offer and in the job's work file - in these words, in this order.
// Unknown keys still show, labelled by their key, so a new question is never
// silently dropped.
export type WorkDetails = Record<string, string | number | boolean | null>;

const LABELS: [key: string, label: string][] = [
  ["location", "Where it goes"],
  ["vehicle", "Car"],
  ["distance_ft", "Run from the panel"],
  ["distance_band", "Priced as"],
  ["amps", "Charging level"],
  ["subpanel", "Subpanel"],
  ["subpanel_where", "Subpanel is"],
];

export function workDetailRows(d: WorkDetails | null | undefined): { label: string; value: string }[] {
  if (!d || typeof d !== "object") return [];
  const known = new Set(LABELS.map(([k]) => k));
  const show = (k: string, v: WorkDetails[string]) =>
    v === true ? "Yes" : v === false ? "No" : k === "distance_ft" ? `${v} ft` : String(v);
  return [
    ...LABELS.filter(([k]) => d[k] != null && d[k] !== "").map(([k, label]) => ({ label, value: show(k, d[k]!) })),
    ...Object.entries(d).filter(([k, v]) => !known.has(k) && v != null && v !== "").map(([k, v]) => ({ label: k.replace(/_/g, " "), value: show(k, v) })),
  ];
}
