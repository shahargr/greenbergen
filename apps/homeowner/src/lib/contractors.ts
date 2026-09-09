import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";

// The community roster, as a member sees it (homeowner_contractors, migration
// 028): who is approved, what they do, where they work, how they have done.
// No phone, email or street address by design - the match is the product.
export type Rating = { score: number; responses: number; provisional: boolean } | null;
export type Pro = {
  id: string; name: string; company: string | null; website: string | null;
  service_zip: string | null; service_radius_miles: number | null; serves_adjacent_states: boolean;
  approved_at: string | null;
  trades: { trade: string; licence: string | null }[];
  rating: Rating; jobs_done: number; jobs_live: number;
  packages: { code: string; title: string; line2: string | null; illustration: string }[];
};

export async function loadContractors(id?: string): Promise<Pro[]> {
  const supabase = await createClient();
  const { data, error } = await rpc<Pro[]>(supabase, "homeowner_contractors", id ? { p_contact: id } : { p_contact: null });
  if (error) { console.error("homeowner_contractors:", error.message); return []; }
  return Array.isArray(data) ? data : [];
}

// "Tenafly · 15 mi" - where they work, said the short way.
export function areaLine(p: Pro, town: string | null): string | null {
  const bits: string[] = [];
  if (town) bits.push(town); else if (p.service_zip) bits.push(p.service_zip);
  if (p.service_radius_miles) bits.push(`${p.service_radius_miles} mi`);
  if (p.serves_adjacent_states) bits.push("NY & CT too");
  return bits.length ? bits.join(" · ") : null;
}
