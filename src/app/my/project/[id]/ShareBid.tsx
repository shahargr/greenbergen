import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { shareBid } from "./actions";

type Candidate = {
  contact_id: string; name: string; company: string | null; trades: string[];
  on_this_project: boolean; already_invited: boolean;
};

// Hand the description and its photos to contractors as a bid. They find it
// in their inbox, answer it there, and hear back either way when you decide.
export async function ShareBid({ projectId, trades }: { projectId: string; trades: string[] }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_bid_candidates", { p_project: projectId });
  const people = ((data ?? []) as Candidate[]);
  const fresh = people.filter((p) => !p.already_invited);
  const invited = people.filter((p) => p.already_invited);

  return (
    <div id="share" className="card" style={{ display: "grid", gap: 8, minWidth: 0 }}>
      <h2 className="section-title" style={{ margin: 0 }}>Send this out for bids</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Your description and photos go across as they stand. Each contractor gets it in their inbox, answers it there, and is told either way once you decide.
      </p>

      {people.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>
          Nobody to send to yet. <Link href={`/my/invite?project=${projectId}`}>Invite a contractor</Link> and they will appear here.
        </p>
      ) : (
        <form action={shareBid.bind(null, projectId)} style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gap: 4 }}>
            {fresh.map((p) => (
              <label key={p.contact_id} className="small" style={{ display: "flex", gap: 8, alignItems: "baseline", margin: 0 }}>
                <input type="checkbox" name="contact" value={p.contact_id} />
                <span style={{ minWidth: 0 }}>
                  <strong>{p.name}</strong>
                  {p.company && <span className="muted"> · {p.company}</span>}
                  {p.trades.length > 0 && <span className="muted"> · {p.trades.join(", ")}</span>}
                  {p.on_this_project && <span className="extra-chip" style={{ marginLeft: 6, fontSize: 10 }}>on this project</span>}
                </span>
              </label>
            ))}
            {fresh.length === 0 && <p className="muted small" style={{ margin: 0 }}>Everyone you know has already been invited to this one.</p>}
          </div>

          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sb-trade">For which trade</label>
              <select id="sb-trade" name="trade" className="input" defaultValue={trades[0] ?? ""}>
                <option value="">The whole job</option>
                {trades.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="sb-by">Answer by</label>
              <input id="sb-by" name="reply_by" className="input" type="date" />
            </div>
          </div>

          <div><button className="btn small">Send the brief</button></div>
        </form>
      )}

      {invited.length > 0 && (
        <p className="muted small" style={{ margin: 0, borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
          Already holding this brief: {invited.map((p) => p.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
