import Link from "next/link";
import { redirect } from "next/navigation";
import { AppBar, Card, DoorSwitch, Screen } from "@shared/ui";
import { loadDoors } from "@shared/doors.server";
import { getBoard, runs } from "@/lib/me";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your account" };

export default async function SettingsPage() {
  // Neither read depends on the other, so they leave together.
  const [board, doors] = await Promise.all([getBoard(), loadDoors()]);
  if (!board.signed_in) redirect("/login?next=/settings");
  const manages = board.seats.filter(runs).length;

  return (
    <Screen>
      <AppBar back="/" title="Your account" />
      <div className="body">
        <Card pad>
          <div className="card-title">{board.me?.full_name ?? board.me?.email ?? "Your account"}</div>
          <div className="small text-muted">{board.me?.email}</div>
          <div className="small text-muted" style={{ marginTop: 6 }}>
            {board.seats.length} {board.seats.length === 1 ? "seat" : "seats"}
            {manages ? ` · ${manages} you run` : ""}
            {board.me?.is_superadmin ? " · admin" : ""}
          </div>
        </Card>

        <DoorSwitch held={doors.held} current="builder" />

        <Card soft pad>
          <div className="kicker">Next</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            Your profile, business and terms are step 7 — they already have their
            functions (portal_my_profile, portal_my_business, portal_my_terms_save).
            For now they live in <Link href="https://greenbergen.vercel.app/my/profile">the owner portal</Link>.
          </p>
        </Card>

        <section className="stack" style={{ gap: 8 }}>
          <div className="divider-label">Account</div>
          <Card soft pad>
            <div className="small text-muted" style={{ marginBottom: 10 }}>
              One login across the homeowner, contractor and builder apps. Signing out signs you out of this one.
            </div>
            <form action={signOut}><button className="btn btn-secondary btn-block">Sign out</button></form>
          </Card>
        </section>
      </div>
    </Screen>
  );
}
