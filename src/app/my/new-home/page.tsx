import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { NewHomeForm, type RoomType } from "./NewHomeForm";

export const dynamic = "force-dynamic";

// A clean screen for adding a property - nothing above it but the way back.
// The agreement decides whether another home is allowed (may_create_project
// with no parent counts roots against assets_allowed). The room types come
// from blueprint_spaces - the ones meant for people to see, not the bases
// and the utility internals.
export default async function NewHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data: allowed }, { data: spaceRows }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("may_create_project"),
    supabase.from("blueprint_spaces").select("code, label, parent_code, is_wet, bed_count, bath_count, show_on_public").order("label"),
  ]);
  const homesAllowed: number | null = me?.agreement?.assets_allowed ?? null;
  const rooms: RoomType[] = ((spaceRows ?? []) as { code: string; label: string; parent_code: string | null; is_wet: boolean; bed_count: number | null; bath_count: number | null; show_on_public: boolean }[])
    .filter((r) => r.show_on_public)
    .map((r) => ({ code: r.code, label: r.label, parent: r.parent_code, wet: r.is_wet, bed: r.bed_count ?? 0, bath: Number(r.bath_count ?? 0) }));

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 560 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <span className="kicker">Property</span>
      <h1 style={{ fontSize: 26, margin: "4px 0 12px" }}>Add a home</h1>
      {error && <p className="error small">{error}</p>}
      {allowed === true ? (
        <NewHomeForm rooms={rooms} />
      ) : (
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <p className="small" style={{ margin: 0 }}>
            Your agreement does not cover another home right now{homesAllowed != null ? ` (it allows ${homesAllowed})` : ""}.
          </p>
          <p className="muted small" style={{ margin: 0 }}>Ask us for more from the home page — the request lands with us as a task.</p>
          <div><Link className="btn ghost" href="/my">← Back</Link></div>
        </div>
      )}
    </main>
  );
}
