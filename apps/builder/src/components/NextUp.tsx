import Link from "next/link";
import { AppBar, Card, Screen } from "@shared/ui";
import { BuildTabs } from "@/components/BuildTabs";

// Steps 3 to 7 of the build order. Named rather than shipped empty: a GC who
// taps Money and sees a blank screen concludes the numbers are zero, which
// is worse than being told the screen is not finished.
export function NextUp({ title, lead, tab, step }: {
  title: string; lead: string; tab: "board" | "tasks" | "money" | "inbox"; step: string;
}) {
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <div className="hero"><h1>{title}</h1><p className="lead">{lead}</p></div>
        <Card soft pad>
          <div className="small">
            Not built yet — {step}. The database side already exists, so this is a screen
            away, not a project away. <Link href="/">Back to the board</Link>
          </div>
        </Card>
      </div>
      <BuildTabs current={tab} />
    </Screen>
  );
}
