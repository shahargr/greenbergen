import { createClient } from "@/lib/supabase/server";
import { InviteBuilder } from "./InviteBuilder";

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

export default async function InvitePage() {
  const supabase = await createClient();
  const [{ data: me }, { data: sentData }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("my_invitation_results"),
  ]);
  const sent: SentInvitation[] = (sentData as SentInvitation[]) ?? [];

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <span className="kicker">Invite</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Invite someone</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        Create an invitation link and send it however you like.
      </p>
      <InviteBuilder
        isSuperadmin={me?.is_superadmin ?? false}
        senderName={me?.full_name ?? "Someone"}
      />

      {sent.length > 0 && (
        <div className="card" style={{ marginTop: 14, display: "grid", gap: 10 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your invitations</h2>
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
                <span className="muted small">Waiting — not accepted yet.</span>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
