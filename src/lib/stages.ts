// Where a project stands in the engagement ladder (the engagement_stages
// table). Separate from projects.status, which stays the open / closed
// lifecycle every task count and tile filter reads.
export const PROJECT_STAGES = ["bid", "compare", "awarded", "sign", "schedule", "active", "delivered", "verification", "close"];

export const STAGE_LABEL: Record<string, string> = {
  bid: "Bid", compare: "Compare", awarded: "Awarded", sign: "Sign",
  schedule: "Schedule", active: "Active", delivered: "Delivered",
  verification: "Verification", close: "Close",
};
