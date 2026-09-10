// What project_financials(project) returns (migration 057) - checked
// against live output. Amounts are DOLLARS, as contracts, payment_stages and
// transactions hold them; the package catalogue is the side that uses cents.

export type FinEvidence = {
  file_id: string; file_name: string | null; kind: string | null; mime: string | null;
  bucket: string; path: string; role: string; at: string; who: string | null;
};

export type FinSettlement = {
  reference: string | null; status: string; paid_on: string | null; amount: number | null; method: string | null;
};

export type FinStageTx = {
  id: string; status: string | null; amount: number | null; paid_on: string | null; reference: string | null;
  // The open "awaiting confirmation" task the ledger row spawned, if any.
  confirm_task: string | null;
};

export type FinStage = {
  id: string; name: string; sequence_no: number | null; amount: number | null; percent: number | null;
  trigger: string | null; due_on: string | null; status: string; settlement_status: string;
  paid_at: string | null; requires_photo: boolean; retainage_withheld: number | null; is_retainage_release: boolean;
  method: string | null; evidence: FinEvidence[]; settlement: FinSettlement | null; transaction: FinStageTx | null;
};

export type FinChange = {
  id: string; title: string; amount: number | null; status: string; scope: string | null; notes: string | null;
  created_at: string; created_by: string | null; approved: boolean; evidence: FinEvidence[];
  stage: { id: string; status: string; settlement_status: string; paid_at: string | null } | null;
};

export type FinAttachment = { file_id: string; file_name: string | null; kind: string | null; bucket: string; path: string };

export type FinTx = {
  id: string; description: string; amount: number | null; paid_on: string | null; status: string | null;
  moved: boolean; reference: string | null; invoice: string | null; method: string | null;
  stage_id: string | null; change_order: boolean; target_amount: number | null; target_date: string | null;
  attachments: FinAttachment[];
};

export type FinContract = {
  id: string; title: string; trade: string | null; type: string; status: string | null;
  amount: number | null; currency: string; retainage_pct: number | null; deposit_pct: number | null;
  net_days: number | null; scope: string | null; signed_date: string | null; method: string | null;
  project: { id: string; name: string };
  contractor: { id: string | null; name: string | null; company: string | null } | null;
  // This viewer is the one being paid on it.
  payee: boolean;
  evidence: FinEvidence[];
  change_orders: FinChange[];
  stages: FinStage[];
  transactions: FinTx[];
  totals: { agreed: number; paid: number; retained: number; requested: number };
};

export type FinUnassignedStage = {
  id: string; name: string; sequence_no: number | null; amount: number | null; percent: number | null;
  status: string; settlement_status: string; project: { id: string; name: string };
};

export type FinOtherCost = {
  id: string; description: string; amount: number | null; paid_on: string | null; status: string | null;
  method: string | null; category: string | null; project: string | null;
};

export type FinMethod = { id: string; name: string; requires_reference: boolean | null };

export type Financials =
  | { ok: false; reason: string }
  | {
      ok: true;
      project: { id: string; name: string; address: string | null; status: string | null; parent_project_id: string | null };
      me: { rank: number; may_record: boolean; all: boolean; contact_id: string | null; name: string | null; is_superadmin: boolean };
      totals: { agreed: number; paid: number; outstanding: number; retained: number; requested: number; other_paid: number };
      contracts: FinContract[];
      unassigned_stages: FinUnassignedStage[];
      other_costs: { count: number; rows: FinOtherCost[] } | null;
      methods: FinMethod[];
    };

// Dollars, as the money tables hold them. Whole dollars unless there are
// cents to show.
export const usd = (n: number | null | undefined) => {
  if (n == null) return "—";
  const v = Number(n);
  const whole = Math.abs(v - Math.round(v)) < 0.005;
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return v < 0 ? `−$${s}` : `$${s}`;
};

// A milestone reads as one word.
export const stageTone = (s: FinStage): { label: string; cls: string } => {
  if (s.settlement_status === "paid" || s.status === "Paid") return { label: "Paid", cls: "tag-ok" };
  if (s.settlement_status === "pending_clearance") return { label: "Sent, not cleared", cls: "tag-outline" };
  switch (s.status) {
    case "Requested": return { label: "Payment requested", cls: "tag-status" };
    case "Approved": return { label: "Approved to pay", cls: "tag-accent" };
    case "Ready": return { label: "Ready", cls: "tag-outline" };
    case "Disputed": return { label: "Disputed", cls: "tag-danger" };
    case "Cancelled": return { label: "Cancelled", cls: "tag-neutral" };
    default: return { label: "Planned", cls: "tag-neutral" };
  }
};

export const changeTone = (c: FinChange): { label: string; cls: string } => {
  if (c.stage?.settlement_status === "paid") return { label: "Paid", cls: "tag-ok" };
  if (c.approved) return { label: "Approved", cls: "tag-accent" };
  switch (c.status) {
    case "requested": return { label: "Awaiting decision", cls: "tag-status" };
    case "declined": return { label: "Declined", cls: "tag-danger" };
    case "withdrawn": return { label: "Withdrawn", cls: "tag-neutral" };
    default: return { label: c.status, cls: "tag-neutral" };
  }
};
