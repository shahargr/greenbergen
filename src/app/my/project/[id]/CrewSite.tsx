import { createClient } from "@/lib/supabase/server";
import { FileDrop } from "@/components/FileDrop";
import { siteCheck, crewUpload } from "./actions";
import { acceptFor, type Caps } from "@/lib/caps";

type Day = {
  date: string; on_site: boolean; arrived_at: string | null; left_at: string | null;
  events: { kind: string; at: string; note: string | null }[];
};

const clock = (t: string | null) =>
  t ? new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "—";

// The whole project, for a hand on site: are you here, a photo, a word, and
// signing out at the end. Nothing about money, scope or anyone else's trade.
export async function CrewSite({ projectId, projectName, address, caps }: {
  projectId: string; projectName: string; address: string | null; caps: Caps;
}) {
  const supabase = await createClient();
  const { data } = await supabase.rpc("portal_site_day", { p_project: projectId });
  const day = (data ?? { date: "", on_site: false, arrived_at: null, left_at: null, events: [] }) as Day;

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{
        display: "grid", gap: 10,
        borderLeft: `4px solid ${day.on_site ? "var(--brand)" : "#c9ccc4"}`,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            {day.on_site ? "You are on site" : "Not on site"}
          </h2>
          <span className="muted small">
            {day.arrived_at && <>In {clock(day.arrived_at)}</>}
            {day.left_at && <> · Out {clock(day.left_at)}</>}
          </span>
        </div>
        <p className="muted small" style={{ margin: 0 }}>{address ?? projectName}</p>

        {!day.on_site ? (
          <form action={siteCheck.bind(null, projectId, "arrive")} style={{ display: "grid", gap: 8 }}>
            <input name="note" className="input" placeholder="What you are here for (optional)" />
            <div><button className="btn">🟢 Sign in to site</button></div>
          </form>
        ) : (
          <form action={siteCheck.bind(null, projectId, "leave")} style={{ display: "grid", gap: 8 }}>
            <input name="note" className="input" placeholder="What you finished (optional)" />
            <div><button className="btn" style={{ background: "#7b857e" }}>🔴 Sign out of site</button></div>
          </form>
        )}
      </div>

      {(caps.image || caps.voice) && (
        <form action={crewUpload.bind(null, projectId)} className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Send a photo or a voice note</h2>
          <input name="note" className="input" placeholder="What it shows (optional)" />
          <FileDrop name="files" videoName="videos" accept={acceptFor(caps)}
            label="Add photo" camera={caps.image} hint="or record below" />
          <div><button className="btn small">Send</button></div>
          <p className="muted small" style={{ margin: 0 }}>
            Goes to the project office. You do not need to sort it anywhere.
          </p>
        </form>
      )}

      {day.events.length > 0 && (
        <div className="card" style={{ display: "grid", gap: 4 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Today</h2>
          {day.events.map((e, i) => (
            <div key={i} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid #eef0ec", paddingTop: 4 }}>
              <span>{e.kind === "arrive" ? "🟢 Signed in" : "🔴 Signed out"}{e.note ? ` · ${e.note}` : ""}</span>
              <span className="muted">{clock(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
