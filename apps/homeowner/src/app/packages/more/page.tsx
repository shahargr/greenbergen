import Link from "next/link";
import { COMMUNITY_SERVICES } from "@shared/catalogue";
import { AppBar, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";

export const dynamic = "force-dynamic";
export const metadata = { title: "Group purchases" };

// This used to be the overflow drawer: everything the front grid could not
// fit, plus the coming-soon shelf, plus the community services underneath.
// The catalogue is one list on one screen now, so the drawer has nothing left
// to hold - what survives is the part that was never a package at all.
//
// Community services are a different animal: a cadence rather than a job, sold
// to the street rather than to one house. They keep their own page.
export default function CommunityServicesPage() {
  return (
    <Screen>
      <AppBar back="/packages" title="Group purchases" />
      <div className="body">
        <div className="hero">
          <h1>Things a whole street buys together.</h1>
          <p className="lead">
            Not one job at one house — a cadence for the block, priced because enough neighbors
            are in. Tap one to see how it works.
          </p>
        </div>
        {COMMUNITY_SERVICES.map((s) => (
          <Link key={s.code} href={`/services/${s.code}`} className="tile wide">
            <div className="art"><Illustration name={s.illustration} /></div>
            <div className="grow">
              <div className="card-title">{s.name}</div>
              <div className="small text-muted">{s.summary}</div>
            </div>
            <span className="tag tag-accent">{s.cadence}</span>
          </Link>
        ))}
      </div>
    </Screen>
  );
}
