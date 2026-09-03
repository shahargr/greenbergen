import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { InviteBuilder } from "./InviteBuilder";
import { cancelInvitation, clearRevokedInvitations, inviteToProject } from "./actions";

type Acceptor = {
  name: string;
  email: string | null;
  phone: string | null;
  accepted_at: string | null;
  company: string | null;
  vendor_status: string | null;
  trades: string[];
  insurance: { workers_comp: boolean | null; liability: boolean | null; gc: boolean | null } | null;
};

type SentInvitation = {
  id: string;
  status: string;
  created_at: string;
  expires_at: string | null;
  invitee_name: string | null;
  invitee_email: string | null;
  resident: boolean;
  uses: number;
  max_uses: number | null;
  comment: string | null;
  acceptors: Acceptor[];
};

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; error?: string; ok?: string; project?: string }>;
}) {
  const { status: statusFilter, error, ok, project: projectId } = await searchParams;
  const supabase = await createClient();
  // ?project= (from a project card): show which project this invite is for
  // and seed the note with it — invitations themselves aren't project-scoped.
  const [{ data: me }, { data: sentData }, { data: forProject }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("my_invitation_results"),
    projectId
      ? supabase.from("projects").select("id, project_name").eq("id", projectId).maybeSingle()
      : Promise.resolve({ data: null as { id: string; project_name: string } | null }),
  ]);
  const forName = forProject?.project_name ?? null;
  // Projects I can invite to (for the picker when none was passed in).
  const invitable = ((me?.projects ?? []) as { project_id: string; project_name: string; can_invite: boolean; role: string }[])
    .filter((p) => p.can_invite || p.role === "owner" || me?.is_superadmin);
  const all: SentInvitation[] = (sentData as SentInvitation[]) ?? [];
  // An invitation with acceptors counts as accepted whatever its row says.
  const effective = (i: SentInvitation) => (i.acceptors.length > 0 ? "accepted" : i.status);
  const counts = new Map<string, number>();
  for (const i of all) counts.set(effective(i), (counts.get(effective(i)) ?? 0) + 1);
  const filter = statusFilter && statusFilter !== "all" ? statusFilter : null;
  const sent = filter ? all.filter((i) => effective(i) === filter) : all;

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <span className="kicker">Invite</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Invite someone</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Create an invitation link and send it however you like.
      </p>
      {error && <p className="error small">{error}</p>}
      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {forName && (
        <p className="small" style={{ margin: "0 0 10px" }}>
          <span className="extra-chip">For <strong>{forName}</strong></span>
        </p>
      )}
      {/* Invite an account already on the platform, by email or phone. They
          answer on their next login; the answer shows on the inviter's home. */}
      <form action={inviteToProject} className="card" style={{ display: "grid", gap: 10, marginBottom: 14 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Invite a user to {forName ? <strong>{forName}</strong> : "a project"}</h2>
        {forProject ? (
          <input type="hidden" name="project" value={forProject.id} />
        ) : (
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="pi-project">Project</label>
            <select id="pi-project" name="project" className="input" required defaultValue="">
              <option value="" disabled>Pick a project…</option>
              {invitable.map((p) => <option key={p.project_id} value={p.project_id}>{p.project_name}</option>)}
            </select>
          </div>
        )}
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pi-contact">Their email or phone</label>
          <input id="pi-contact" name="contact" className="input" required autoComplete="off" placeholder="name@example.com or 201-555-0100" />
        </div>
        <div className="radio-row" style={{ minHeight: 0 }}>
          <label className="radio-opt"><input type="radio" name="seat" value="resident" /> Resident</label>
          <label className="radio-opt"><input type="radio" name="seat" value="contractor" defaultChecked /> Contractor</label>
          <label className="radio-opt"><input type="radio" name="seat" value="viewer" /> Viewer</label>
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="pi-note">Note (optional — travels with the invitation)</label>
          <input id="pi-note" name="note" className="input" defaultValue={forName ? `Join me on ${forName}` : ""} />
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          If no account matches, you&apos;ll see &ldquo;wrong user information provided&rdquo; — use the signup link below instead.
        </p>
        <div><button className="btn">Invite user</button></div>
      </form>

      <details className="card" style={{ marginBottom: 14 }}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>Not on the platform yet? Send a signup link</summary>
        <div style={{ marginTop: 10 }}>
          <InviteBuilder
            isSuperadmin={me?.is_superadmin ?? false}
            senderName={me?.full_name ?? "Someone"}
            defaultComment={forName ? `Join me on ${forName}` : undefined}
          />
        </div>
      </details>

      {all.length > 0 && (
        <div className="card" style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your invitations</h2>
          <div className="btn-row" style={{ gap: 6 }}>
            {["all", "pending", "accepted", "declined", "revoked", "expired"].map((st) => {
              const n = st === "all" ? all.length : counts.get(st) ?? 0;
              if (st !== "all" && n === 0) return null;
              const active = (filter ?? "all") === st;
              return (
                <Link
                  key={st}
                  href={st === "all" ? "/my/invite" : `/my/invite?status=${st}`}
                  className={active ? "btn small" : "btn ghost small"}
                >
                  {st} · {n}
                </Link>
              );
            })}
          </div>
          {(counts.get("revoked") ?? 0) > 0 && (filter === "revoked" || filter === null) && (
            <form action={clearRevokedInvitations}>
              <button className="btn ghost small">🗑 Clear all revoked ({counts.get("revoked")})</button>
            </form>
          )}
          {sent.length === 0 && <p className="muted small" style={{ margin: 0 }}>None with this status.</p>}
          {sent.map((i) => (
            <div key={i.id} className="card" style={{ padding: "12px 14px", display: "grid", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <span>
                  <strong>{i.invitee_name ?? i.invitee_email ?? "Open link"}</strong>
                  <span className="muted small"> · {i.resident ? "resident" : "contractor"} · {new Date(i.created_at).toLocaleDateString()}</span>
                </span>
                <span className="extra-chip">{i.acceptors.length > 0 ? "accepted" : i.status}</span>
              </div>
              {i.comment && <span className="muted small">&ldquo;{i.comment}&rdquo;</span>}

              {i.acceptors.map((a, idx) => (
                <div key={idx} className="card" style={{ padding: "10px 12px", background: "#f2f7f3", display: "grid", gap: 3 }}>
                  <strong style={{ fontSize: 14 }}>{a.name}</strong>
                  <span className="small">
                    {a.email && <a href={`mailto:${a.email}`}>{a.email}</a>}
                    {a.email && a.phone && " · "}
                    {a.phone && <a href={`tel:${a.phone}`}>{a.phone}</a>}
                    {a.accepted_at && <span className="muted"> · joined {new Date(a.accepted_at).toLocaleDateString()}</span>}
                  </span>
                  {(a.company || a.trades.length > 0) && (
                    <span className="small">
                      {a.company && <strong>{a.company}</strong>}
                      {a.vendor_status && <span className="muted"> · {a.vendor_status}</span>}
                      {a.trades.length > 0 && <span className="muted"> · {a.trades.join(", ")}</span>}
                    </span>
                  )}
                  {a.insurance && (a.insurance.workers_comp || a.insurance.liability || a.insurance.gc) && (
                    <span className="muted small">
                      Insurance:
                      {a.insurance.workers_comp && " workers' comp"}
                      {a.insurance.liability && " · liability"}
                      {a.insurance.gc && " · new-house GC"}
                    </span>
                  )}
                </div>
              ))}
              {i.acceptors.length === 0 && i.status === "pending" && (
                <span style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span className="muted small">Waiting — not accepted yet.</span>
                  <form action={cancelInvitation}>
                    <input type="hidden" name="id" value={i.id} />
                    <button className="btn ghost small">Cancel invitation</button>
                  </form>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
