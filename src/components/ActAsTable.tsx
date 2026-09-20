import { createClient } from "@/lib/supabase/server";
import { beginViewAs, endViewAs } from "@/components/viewas";

// WHOSE ACCOUNT YOU ARE LOOKING THROUGH - ON THE PEOPLE SCREEN.
//
// Shahar, 2026-09-20: "remove all people from the setup page, they should be
// listed under users & contractors" and "Your contractors should be removed
// from the setup tab as they will all be stored under users & contractors."
//
// This table was on /admin/console - the gear - and it is a LIST OF PEOPLE:
// everyone holding a seat with a login, contractors among them, each with
// view and act beside their name. Two places listing the same people is how
// they drift, and the console is not where you go to look somebody up. So the
// people live on /admin/users with the rest of the people, and the console
// keeps only the state you are currently in.
//
// Self-fetching rather than prop-drilled, so it is correct wherever it is
// dropped: admin_view_targets is SECURITY DEFINER and returns nothing to a
// non-superadmin, and every action re-checks server-side.

type Target = {
  project_id: string; name: string;
  seats: { app_user_id: string; name: string; project_role: string | null; role: string; rank: number }[];
};

export async function ActAsTable({ here }: { here: string }) {
  const supabase = await createClient();
  const [{ data: me }, { data: targetData }, { data: borrowed }, { data: canActData }, { data: realIdData }] =
    await Promise.all([
      supabase.rpc("me"),
      supabase.rpc("admin_view_targets"),
      supabase.rpc("borrowed_seat"),
      supabase.rpc("borrowed_can_act"),
      supabase.rpc("real_app_user_id"),
    ]);
  if (!me?.is_superadmin) return null;

  const canAct = canActData === true;
  const realId = typeof realIdData === "string" ? realIdData : null;

  // Everyone holding a seat with a login, once each, with their highest seat
  // as the hint. Never yourself - "Return to myself" is that.
  const best = new Map<string, { name: string; rank: number; hint: string }>();
  for (const t of ((targetData ?? []) as Target[])) {
    for (const st of t.seats ?? []) {
      const hint = `${st.project_role ?? st.role} · ${t.name}`;
      const cur = best.get(st.app_user_id);
      if (!cur || st.rank > cur.rank) best.set(st.app_user_id, { name: st.name, rank: st.rank, hint });
    }
  }
  const people = [...best.entries()]
    .filter(([id]) => id !== realId)
    .map(([id, v]) => ({ id, name: v.name, hint: v.hint }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="card" id="act-as" style={{ marginBottom: 12 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>View or act as somebody</h2>
      {borrowed ? (
        <p className="small" style={{ marginTop: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            {canAct
              ? <>⚡ You are <strong>acting as</strong> {me?.full_name ?? me?.email}. Every change lands as them.</>
              : <>👁 You are <strong>viewing as</strong> {me?.full_name ?? me?.email} — changes are refused.</>}
          </span>
          <form action={endViewAs.bind(null, here)}>
            <button className="btn ghost small">↩ Return to myself</button>
          </form>
        </p>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          <strong>View</strong> shows the system through somebody&rsquo;s eyes and refuses every change;{" "}
          <strong>act</strong> does things as them and writes your name into the log behind it.
        </p>
      )}

      {people.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>Nobody else holds a seat with a login yet.</p>
      )}
      {people.length > 0 && (
        <table className="tasktable" style={{ width: "100%" }}>
          <tbody>
            {people.map((u) => {
              const isCurrent = String(borrowed ?? "") === u.id;
              return (
                <tr key={u.id}>
                  <td>
                    {isCurrent && "✓ "}<strong>{u.name}</strong>
                    {u.hint && <div className="muted small">{u.hint}</div>}
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                    <span style={{ display: "inline-flex", gap: 6 }}>
                      <form action={beginViewAs.bind(null, u.id, false, here)}>
                        <button className="btn ghost small" title="Their eyes only; changes refused">view</button>
                      </form>
                      <form action={beginViewAs.bind(null, u.id, true, here)}>
                        <button className="btn small" title="Do things as them; logged with your name behind it">act</button>
                      </form>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
