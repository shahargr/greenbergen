import { createClient } from "@/lib/supabase/server";
import { createHome, signOut } from "./actions";

type HomeProject = {
  id: string;
  name: string;
  address: string | null;
  status: string;
  live: boolean;
};

// The portal home reads consumer_home() - one call, shaped by the database:
// who you are, whether your agreement lets you add a home, and your projects.
export default async function MyPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: home } = await supabase.rpc("consumer_home");

  const name: string = home?.name ?? "there";
  const canCreate: boolean = home?.can_create ?? false;
  const projects: HomeProject[] = home?.projects ?? [];

  return (
    <main className="wrap" style={{ paddingTop: 48, paddingBottom: 96 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <h1 style={{ fontSize: 26 }}>Hi {name}</h1>
        <form action={signOut}>
          <button className="btn ghost" style={{ padding: "6px 12px" }}>Sign out</button>
        </form>
      </header>

      {error && <p className="error">{error}</p>}

      <section style={{ display: "grid", gap: 12, margin: "24px 0" }}>
        {projects.length === 0 && (
          <p className="muted">No homes or projects yet.</p>
        )}
        {projects.map((p) => (
          <div key={p.id} className="card">
            <strong>{p.name}</strong>
            <div className="muted" style={{ fontSize: 14 }}>
              {p.address ?? "No address"} · {p.status}
            </div>
          </div>
        ))}
      </section>

      {canCreate && (
        <section className="card" style={{ maxWidth: 480 }}>
          <h2 style={{ fontSize: 18, marginTop: 0 }}>Add your home</h2>
          <form action={createHome}>
            <div className="field">
              <label htmlFor="name">What should we call it?</label>
              <input id="name" name="name" className="input" required placeholder="e.g. Our house" />
            </div>
            <div className="field">
              <label htmlFor="address">Property address</label>
              <input id="address" name="address" className="input" required placeholder="12 Maple Ave, Tenafly NJ" />
            </div>
            <button className="btn">Add home</button>
          </form>
        </section>
      )}
      {!canCreate && projects.length === 0 && (
        <p className="muted">
          Your account has no active agreement yet — ask us for an invitation.
        </p>
      )}
    </main>
  );
}
