"use client";

import { createClient } from "../supabase/client";
import { friendly } from "../rpc";

// Every money write answers {ok, reason}; a raised error is the database
// refusing something the function did not anticipate. Both become one
// sentence for the screen.
export async function callFin(fn: string, args: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; reason: string }> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, reason: friendly(error.message) };
  if (data && typeof data === "object" && (data as { ok?: boolean }).ok === false) {
    return { ok: false, reason: (data as { reason?: string }).reason ?? "That did not work." };
  }
  return { ok: true, data: (data ?? {}) as Record<string, unknown> };
}
