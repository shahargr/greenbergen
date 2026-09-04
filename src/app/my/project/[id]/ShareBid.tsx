import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ShareBidForm, type Candidate } from "./ShareBidForm";

// Hand the description and its photos to contractors as a bid. They find it
// in their inbox, answer it there, and hear back either way when you decide.
export async function ShareBid({ projectId, trades }: { projectId: string; trades: string[] }) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_bid_candidates", { p_project: projectId });
  const people = ((data ?? []) as Candidate[]);

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
        <ShareBidForm projectId={projectId} candidates={people} trades={trades} />
      )}
    </div>
  );
}
