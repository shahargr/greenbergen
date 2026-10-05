import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// One me() per request: the layout's TopNav and the page share this via
// React's per-request cache instead of each paying a round trip.
export const getMe = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("me");
  return data as {
    app_user_id?: string; contact_id?: string | null; email?: string;
    full_name?: string | null; is_superadmin?: boolean;
    // The live agreement and the seats me() carries; typed loosely because
    // each caller casts the part it reads.
    agreement?: { assets_allowed?: number | null } | null;
    projects?: unknown[] | null;
  } | null;
});

// For server actions that write admin tables directly: RLS is the real
// boundary, but a stranger's request should be turned away before it costs
// a write attempt. Same shape as admin() in admin/users/actions.ts.
export async function requireAdmin() {
  const me = await getMe();
  if (!me?.is_superadmin) redirect("/my");
  return me;
}
