// The derived progress line of a booking, as homeowner_progress() returns it.
// Shared: the homeowner app draws it, the contractor app will too.
export type Progress = {
  nodes: {
    key: string; kind: "booked" | "accepted" | "payment" | "task" | "done"; name: string; sequence_no: number;
    percent_of_contract: number | null; typical_range: string | null; trigger_description: string | null;
    status: "done" | "current" | "upcoming"; at: string | null;
    stage_id?: string; amount_cents?: number; stage_status?: string; settlement_status?: string; paid_at?: string | null; settled?: boolean; unsettled?: boolean;
    action_id?: string; action_status?: string;
  }[];
  done_count: number; total: number; current: Progress["nodes"][number] | null;
};

