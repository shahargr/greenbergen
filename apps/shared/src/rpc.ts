import type { SupabaseClient } from "@supabase/supabase-js";

// Supabase occasionally rejects a just-refreshed session with "JWT issued at
// future" (clock skew, gone a moment later). One short retry absorbs it.
const SKEW = /issued at future|iat/i;

export type RpcResult<T> = { data: T | null; error: { message: string; code?: string } | null };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rpc<T = any>(
  supabase: SupabaseClient,
  fn: string,
  args?: Record<string, unknown>
): Promise<RpcResult<T>> {
  const first = await supabase.rpc(fn, args);
  if (first.error && SKEW.test(first.error.message)) {
    await new Promise((r) => setTimeout(r, 1200));
    return (await supabase.rpc(fn, args)) as RpcResult<T>;
  }
  return first as RpcResult<T>;
}

// A function the database does not have yet (the migration in db/ has not
// been applied). The app says so instead of showing a broken page. Only the
// FUNCTION-missing shapes count: a column or relation that "does not exist"
// is a broken migration and must surface as the real error.
export const isMissingFunction = (error: { message: string; code?: string } | null) =>
  !!error && (error.code === "42883" || error.code === "PGRST202"
    || /could not find the function|function .* does not exist/i.test(error.message));

// Postgres raises "CODE: message" from the homeowner functions; show the message.
export const friendly = (msg: string | undefined | null, fallback = "Something went wrong.") => {
  if (!msg) return fallback;
  const m = msg.match(/^[A-Z_]+: ([\s\S]*)$/);
  return m ? m[1] : msg;
};
