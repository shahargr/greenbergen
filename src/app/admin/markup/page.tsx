import { createClient } from "@/lib/supabase/server";
import { addMember, removeMember, saveGroup, saveMarkup } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mark-up · Admin" };

// MARK-UP (Shahar, 2026-09-25; migration 237): "for all packages, add an
// admin option for mark-up on top of contractor price. default is 15%" -
// "one setting for all users, with override per groups of users. Groups of
// users to be defined in the Admin portal for now."
//
// A package's price in Admin > Packages is the CONTRACTOR's price. The
// homeowner is shown that plus the mark-up; who they pay is per package
// (rulebook 52). A booking freezes the rate it was
// made at, so changing anything here re-prices nobody who already booked.
type Member = { app_user_id: string; email: string | null; full_name: string | null };
type Group = { id: string; name: string; markup_pct: number | null; notes: string | null; is_active: boolean; members: Member[] };

const EXAMPLE_CENTS = 65000;
const at = (pct: number) => `$${((EXAMPLE_CENTS + Math.round((EXAMPLE_CENTS * pct) / 100)) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

export default async function AdminMarkupPage({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { error, saved } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("admin_markup");
  const global = Number(data?.markup_pct ?? 15);
  const groups: Group[] = data?.groups ?? [];

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Mark-up</h1>
      <p className="muted small" style={{ margin: "0 0 18px", maxWidth: 640 }}>
        Every package price in Fully delivered is what the contractor is paid. Homeowners see that price plus
        the mark-up. Each package says who they pay: the contractor, who pays Green Bergen the mark-up for the
        lead; or Green Bergen upfront, which keeps the mark-up and pays the contractor when they accept the job.
        A booking keeps the rate it was made at, so a change here applies to new bookings only.
      </p>

      {error && <p className="card" style={{ borderLeft: "4px solid var(--danger)" }}>{error}</p>}
      {saved && <p className="card" style={{ borderLeft: "4px solid var(--brand)" }}>{saved}</p>}
      {data?.ok === false && <p className="card" style={{ borderLeft: "4px solid var(--danger)" }}>{data.reason}</p>}

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Everyone</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The mark-up for every homeowner who is not in a group with its own. At {global}%, a $650 contractor price shows as {at(global)}.
        </p>
        <form action={saveMarkup} className="btn-row">
          <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input name="pct" className="input" inputMode="decimal" defaultValue={String(global)} style={{ width: 90 }} required />
            %
          </label>
          <button className="btn">Save</button>
        </form>
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">Groups</h2>
        <p className="muted small" style={{ margin: 0 }}>
          A group gives its members their own mark-up — a builder you work with, a street you are courting, friends and family.
          Leave the mark-up empty and the group uses the one above. A person is in one group at a time.
        </p>
        <form action={saveGroup} className="btn-row">
          <input name="name" className="input" placeholder="New group name" maxLength={80} required style={{ maxWidth: 260 }} />
          <input name="pct" className="input" inputMode="decimal" placeholder={`${global}`} style={{ width: 90 }} aria-label="Mark-up %" />
          <span className="small">%</span>
          <button className="btn">Add group</button>
        </form>
      </div>

      {groups.map((g) => (
        <div key={g.id} className="card" style={{ display: "grid", gap: 10, opacity: g.is_active ? 1 : 0.65 }}>
          <form action={saveGroup} style={{ display: "grid", gap: 8 }}>
            <input type="hidden" name="id" value={g.id} />
            <div className="btn-row">
              <input name="name" className="input" defaultValue={g.name} maxLength={80} required style={{ maxWidth: 260, fontWeight: 700 }} />
              <input name="pct" className="input" inputMode="decimal" defaultValue={g.markup_pct != null ? String(Number(g.markup_pct)) : ""} placeholder={`${global}`} style={{ width: 90 }} aria-label="Mark-up %" />
              <span className="small">%</span>
              <label className="small" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <input type="checkbox" name="active" value="1" defaultChecked={g.is_active} /> Active
              </label>
              <button className="btn">Save</button>
            </div>
            <input name="notes" className="input" defaultValue={g.notes ?? ""} placeholder="Who this group is, and why its price differs" />
            <p className="muted small" style={{ margin: 0 }}>
              {!g.is_active ? "Retired: its members pay the standard mark-up." : g.markup_pct != null ? `Members pay ${Number(g.markup_pct)}% (a $650 job shows as ${at(Number(g.markup_pct))}).` : `No override: members pay the standard ${global}%.`}
            </p>
          </form>

          <div style={{ display: "grid", gap: 4 }}>
            {g.members.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nobody in it yet.</p>}
            {g.members.map((m) => (
              <form key={m.app_user_id} action={removeMember.bind(null, g.id, m.email ?? "")} className="btn-row" style={{ justifyContent: "space-between" }}>
                <span className="small"><strong>{m.full_name ?? m.email}</strong>{m.full_name && m.email ? <span className="muted"> · {m.email}</span> : null}</span>
                <button className="btn ghost small" disabled={!m.email}>Remove</button>
              </form>
            ))}
            <form action={addMember} className="btn-row">
              <input type="hidden" name="group" value={g.id} />
              <input name="email" type="email" className="input" placeholder="Their sign-in email" required style={{ maxWidth: 320 }} />
              <button className="btn ghost">Add to group</button>
            </form>
          </div>
        </div>
      ))}
    </main>
  );
}
