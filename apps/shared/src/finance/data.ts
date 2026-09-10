import type { SupabaseClient } from "@supabase/supabase-js";
import { rpc } from "../rpc";
import { timed } from "../perf";
import type { Financials } from "./types";

// One read for the whole screen, then one signing round for every file it
// shows - the private bucket needs a signed URL per path, asked for together.
export async function loadFinancials(supabase: SupabaseClient, projectId: string): Promise<{ fin: Financials; urls: Record<string, string> }> {
  const { data, error } = await timed("financials", () => rpc<Financials>(supabase, "project_financials", { p_project: projectId }));
  if (error || !data) return { fin: { ok: false, reason: error?.message ?? "Could not read the money on this project." }, urls: {} };
  if (!data.ok) return { fin: data, urls: {} };

  const paths = new Set<string>();
  for (const c of data.contracts) {
    for (const e of c.evidence) if (e.bucket === "project-media") paths.add(e.path);
    for (const s of c.stages) for (const e of s.evidence) if (e.bucket === "project-media") paths.add(e.path);
    for (const co of c.change_orders) for (const e of co.evidence) if (e.bucket === "project-media") paths.add(e.path);
    for (const t of c.transactions) for (const a of t.attachments) if (a.bucket === "project-media") paths.add(a.path);
  }
  const urls: Record<string, string> = {};
  if (paths.size > 0) {
    const { data: signed } = await timed("financials.urls", () =>
      supabase.storage.from("project-media").createSignedUrls([...paths], 3600));
    for (const s of signed ?? []) if (s.path && s.signedUrl) urls[s.path] = s.signedUrl;
  }
  return { fin: data, urls };
}
