import { createClient } from "@/lib/supabase/server";
import { rpcRetry } from "@/lib/rpc";
import { readDoors, type Doors, type DoorsRow } from "@/lib/doors";

// One read for the whole question - which doors this person holds and which
// one they land in. Kept apart from doors.ts because that module is imported
// by the door mask, a client component, and pulling the server's Supabase
// client into the browser bundle fails the build.
export async function loadDoors(): Promise<Doors> {
  const supabase = await createClient();
  const { data, error } = await rpcRetry<DoorsRow>(supabase, "my_doors");
  if (error) return { signed_in: false, admin: false, held: [], preferred: null };
  return readDoors(data ?? null);
}
