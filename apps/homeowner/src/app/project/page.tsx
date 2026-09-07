import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { AppBar, Blueprint, Notice, Screen } from "@shared/ui";
import { House } from "@shared/Illustrations";
import { HomeTabs } from "@/components/HomeTabs";

export const dynamic = "force-dynamic";
export const metadata = { title: "My project" };

// Most members have exactly one project, so this is the project itself, not
// a list. E4 when there is none yet.
export default async function ProjectIndex() {
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/project");
  const live = me.bookings.filter((b) => b.state !== "closed");
  const pick = live[0] ?? me.bookings[0];
  if (pick) redirect(`/project/${pick.project_id}`);

  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        {me.missing && <Notice title="Preview mode">The database migration in db/ has not been applied yet, so projects cannot be read. The catalogue still works.</Notice>}
        <div className="illus"><House /></div>
        <Blueprint pad>
          <h1>No project yet. That&apos;s the whole screen.</h1>
          <p className="lead text-muted" style={{ margin: 0 }}>Once you book a package, this turns into a progress line with your contractor, your folder and your timeline. Most neighbors start with something small.</p>
        </Blueprint>
      </div>
      <div className="actions">
        <Link href="/packages" className="btn btn-primary btn-block blueprint">Pick a package</Link>
        <Link href="/packages/something_else" className="btn btn-ghost btn-block">I already work with a contractor</Link>
      </div>
      <HomeTabs current="project" />
    </Screen>
  );
}
