import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

// One me() per request: the layout's TopNav and the page share this via
// React's per-request cache instead of each paying a round trip.
export const getMe = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.rpc("me");
  return data as {
    app_user_id?: string; contact_id?: string | null; email?: string;
    full_name?: string | null; is_superadmin?: boolean;
  } | null;
});
