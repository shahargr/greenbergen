import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ClaimHomeForm } from "../ClaimHomeForm";

export const dynamic = "force-dynamic";

// A clean screen for adding a property - nothing above it but the way back.
// The agreement decides whether another home is allowed (may_create_project
// with no parent counts roots against assets_allowed).
export default async function NewHomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data: allowed }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("may_create_project"),
  ]);
  const homesAllowed: number | null = me?.agreement?.assets_allowed ?? null;

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 560 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <span className="kicker">Property</span>
      <h1 style={{ fontSize: 26, margin: "4px 0 12px" }}>Add a home</h1>
      {error && <p className="error small">{error}</p>}
      {allowed === true ? (
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <p className="muted small" style={{ margin: 0 }}>
            It gets a page of its own — projects, people, paperwork and money.
            To file it under a portfolio later, use <em>Belongs under</em> on its Setup tab.
          </p>
          <ClaimHomeForm cancelHref="/my" />
        </div>
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
