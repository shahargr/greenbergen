"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/serverMe";

// THE TEXTING SERVICE'S KNOBS, one RPC each. The database checks
// is_superadmin() again inside every function; requireAdmin() here only
// turns a stranger away before the round trip. Same redirect shape as
// storage/actions.ts: the page reads ?saved=1 or ?error= and shows a banner.

const LIMITS = ["phone_per_hour", "phone_per_day", "phone_per_year", "platform_per_day", "flag_threshold"] as const;

const back = (q: string) => redirect(`/admin/sms?${q}`);
const fail = (reason: string) => back(`error=${encodeURIComponent(reason)}`);

// The whole settings form at once. A checkbox that is off is simply absent
// from the form data, so absence means false rather than "leave as is".
export async function saveSmsSettings(formData: FormData) {
  await requireAdmin();
  const p: Record<string, unknown> = {
    enabled: formData.get("enabled") === "on",
    test_mode: formData.get("test_mode") === "on",
    sender_name: String(formData.get("sender_name") ?? "").trim(),
    site_origin: String(formData.get("site_origin") ?? "").trim(),
    allowed_countries: formData.getAll("country").map(String),
  };
  for (const key of LIMITS) {
    const raw = String(formData.get(key) ?? "").trim();
    const n = Number(raw);
    if (raw === "" || !Number.isInteger(n) || n < 0) {
      fail(`${key.replace(/_/g, " ")} has to be a whole number.`);
    }
    p[key] = n;
  }
  if (p.site_origin && !/^https?:\/\/[^\s/]+$/i.test(String(p.site_origin))) {
    fail("The site origin is a host like https://greenbergen.vercel.app, with no path.");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sms_admin_save_settings", { p });
  if (error || !data?.ok) fail(data?.reason ?? error?.message ?? "Failed.");
  back("saved=1");
}

// Block, clear or flag one number. The status is bound by the form that
// renders the button; the note, if any, comes from the form itself.
export async function setSmsFlag(phone: string, status: "flagged" | "blocked" | "cleared", formData: FormData) {
  await requireAdmin();
  // The hand-typed block form has no phone bound, so it carries one as a field.
  const target = (phone || String(formData.get("phone") ?? "")).trim();
  if (!target) fail("Type a number to block.");
  const note = String(formData.get("note") ?? "").trim() || null;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sms_admin_set_flag", { p_phone: target, p_status: status, p_note: note });
  if (error || !data?.ok) fail(data?.reason ?? error?.message ?? "Failed.");
  back("saved=1");
}
