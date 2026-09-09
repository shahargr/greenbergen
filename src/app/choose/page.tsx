import { redirect } from "next/navigation";
import { DOOR_LABEL, DOOR_URL, landing, loadDoors } from "@/lib/doors";
import { Wordmark } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where to?" };

// Shown to anyone holding more than one door. One door resolves straight
// through in /after-login and never gets here.
//
// Admin is in the list now rather than jumping the queue. Shahar holds all
// four, and on most mornings he is not signing in to be an admin - being
// asked once beats landing in the wrong app and hunting for the switcher.
export default async function ChoosePage() {
  const doors = await loadDoors();
  if (doors.held.length < 2) redirect(landing(doors));

  return (
    <main className="wrap" style={{ paddingTop: 40, paddingBottom: 80, maxWidth: 520 }}>
      <Wordmark />
      <h1 style={{ fontSize: 26, margin: "16px 0 4px" }}>Where to?</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        You hold {doors.held.length === 2 ? "both" : `all ${doors.held.length}`} of these. Same sign-in, same
        account — pick the one you want now, and switch any time from the gear.
      </p>
      <div style={{ display: "grid", gap: 10, marginTop: 20 }}>
        {doors.held.map((k) => (
          <a key={k} href={DOOR_URL[k]} className="card" style={{ display: "grid", gap: 2, textDecoration: "none" }}>
            <strong>{DOOR_LABEL[k].title}</strong>
            <span className="muted small">{DOOR_LABEL[k].blurb}</span>
          </a>
        ))}
      </div>
    </main>
  );
}
