import Link from "next/link";
import { AppBar, Card, Screen } from "@shared/ui";
import { WorkTabs } from "@/components/WorkTabs";

// Step 1 of the build order ships sign-in and the shell. These screens are
// steps 3 to 5. They say what is coming and when, because a contractor who
// taps a tab and gets nothing assumes the app is broken - and the empty
// state of a feed that does not exist yet is indistinguishable from having
// no work, which is the worst possible first impression.
export function NextUp({ title, lead, tab }: { title: string; lead: string; tab: "work" | "jobs" | "inbox" }) {
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <div className="hero">
          <h1>{title}</h1>
          <p className="lead">{lead}</p>
        </div>
        <Card soft pad>
          <div className="small">
            Not built yet — this is the next thing we&apos;re making.{" "}
            <Link href="/work">Back to work</Link>
          </div>
        </Card>
      </div>
      <WorkTabs current={tab} />
    </Screen>
  );
}
