import { createClient } from "./supabase/server";
import { rpc } from "./rpc";
import { timed } from "./perf";
import { NO_DOORS, readDoors, type Doors, type DoorsRow } from "./doors";

// One read for the whole question. my_doors() answers all four doors in a
// single round trip - which matters, because a round trip to Supabase costs
// ~187 ms warm and this is asked on every signed-in screen. Anything that
// already loads its own shell data should call this alongside it inside the
// same Promise.all rather than awaiting it separately.
export async function loadDoors(): Promise<Doors> {
  const supabase = await createClient();
  const { data, error } = await timed("doors", () => rpc<DoorsRow>(supabase, "my_doors"));
  if (error) return NO_DOORS;
  return readDoors(data ?? null);
}
