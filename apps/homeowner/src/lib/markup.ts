import { cache } from "react";
import { createClient } from "@shared/supabase/server";
import { loadPublicSettings, withMarkup } from "@shared/catalogue";
import { rpc } from "@shared/rpc";

// THE VIEWER'S MARK-UP (migration 237). Every price a homeowner sees is the
// contractor price plus this. A visitor carries the one setting (read through
// the same cached public_settings as the tagline); a member carries their own
// - their user group's override when they have one - from my_markup_pct().
// Once per request: every page that prices something asks.
export const viewerMarkup = cache(async (): Promise<number> => {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims?.sub) {
    const { data, error } = await rpc<number | string>(supabase, "my_markup_pct");
    if (!error && data != null && Number.isFinite(Number(data))) return Number(data);
  }
  return (await loadPublicSettings()).markupPct;
});

// A package or a tile list, priced for this viewer.
export async function priced<T extends object>(x: T): Promise<T & { markup_pct: number }> {
  return withMarkup(x, await viewerMarkup());
}
export async function pricedAll<T extends object>(xs: T[]): Promise<(T & { markup_pct: number })[]> {
  const pct = await viewerMarkup();
  return xs.map((x) => withMarkup(x, pct));
}
