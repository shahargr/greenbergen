import { redirect } from "next/navigation";
import { DOOR_LABEL, DOOR_URL, landing, loadDoors } from "@/lib/doors";
import { Wordmark } from "@/components/SiteHeader";

export const dynamic = "force-dynamic";
export const metadata = { title: "Where to?" };

// Shown only to someone who holds more than one door and is not an admin.
// One door resolves straight through in /after-login and never gets here;
// an admin lands in the portal, which is theirs.
export default async function ChoosePage() {
  const doors = await loadDoors();
  if (doors.held.length < 2) redirect(landing(doors));

  return (
    <main className="wrap" style={{ paddingTop: 40, paddingBottom: 80, maxWidth: 520 }}>
      <Wordmark />
      <h1 style={{ fontSize: 26, margin: "16px 0 4px" }}>Where to?</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        You hold more than one of these. Same sign-in, same account — pick the one you want now,
        and switch any time from the gear.
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
