// Client-safe: the wizard imports this, so nothing server-only lives here.
export type BookingState = "planned" | "posted" | "accepted" | "closed" | "done";
export type TargetWindow = "asap" | "1_3_months" | "3_6_months" | "this_year" | "someday";
export const TARGET_WINDOWS: { key: TargetWindow; label: string; hint: string }[] = [
  { key: "asap", label: "As soon as I can", hint: "Just not today" },
  { key: "1_3_months", label: "In the next 1–3 months", hint: "This season" },
  { key: "3_6_months", label: "In 3–6 months", hint: "Next season" },
  { key: "this_year", label: "Sometime this year", hint: "When the budget allows" },
  { key: "someday", label: "Someday", hint: "A wish list is fine" },
];
export const targetWindowLabel = (w: string | null | undefined) => TARGET_WINDOWS.find((t) => t.key === w)?.label ?? "Someday";

