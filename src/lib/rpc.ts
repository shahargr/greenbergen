import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase occasionally rejects a just-refreshed session with "JWT issued
// at future" - clock skew between the token issuer and validator, gone a
// moment later. One short retry absorbs it instead of rendering a broken
// page (this was behind the phantom "no agreement" states).
const SKEW = /issued at future|iat/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpcRetry<T = any>(
  supabase: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>
): Promise<{ data: T | null; error: { message: string } | null }> {
  const first = await supabase.rpc(fn, args);
  if (first.error && SKEW.test(first.error.message)) {
    await new Promise((r) => setTimeout(r, 1200));
    return (await supabase.rpc(fn, args)) as { data: T | null; error: { message: string } | null };
  }
  return first as { data: T | null; error: { message: string } | null };
}
