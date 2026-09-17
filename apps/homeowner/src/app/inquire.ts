"use server";

import { createClient } from "@shared/supabase/server";

// A NEW-BUILD LEAD FROM THE FRONT DOOR. The one KPI of the repositioned site
// (action a8d869ca): inquiries. It goes through the path that already
// existed for a house page - about_inquire writes project_inquiries and a
// trigger opens a lead task under the project (fn_inquiry_creates_action) -
// aimed at the company's own project rather than a house, which
// public_company() names since migration 169. Anonymous is fine: the
// function is the anon surface's one deliberate write, and it validates
// every field itself.
export async function inquireBuild(input: {
  projectId: string;
  name: string;
  phone: string | null;
  email: string | null;
  lot: string | null;
  message: string | null;
}): Promise<{ ok: true } | { error: string }> {
  const supabase = await createClient();
  const body = [
    "Build with us (front door).",
    input.lot ? `Lot or town: ${input.lot}` : null,
    input.message,
  ].filter(Boolean).join("\n");
  const { data, error } = await supabase.rpc("about_inquire", {
    p_project_id: input.projectId,
    p_name: input.name,
    p_phone: input.phone,
    p_email: input.email,
    p_kind: "more_info",
    p_message: body || null,
    p_preferred_date: null,
  });
  if (error || data !== "ok") {
    const raw = typeof data === "string" && data.startsWith("ERROR: ") ? data.slice(7) : null;
    return { error: raw ?? "That did not send. Try again, or call." };
  }
  return { ok: true };
}
