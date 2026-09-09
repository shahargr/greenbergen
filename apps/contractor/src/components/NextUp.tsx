import Link from "next/link";
import { AppBar, Card, Screen } from "@shared/ui";
import { ExpertTabs } from "@/components/ExpertTabs";

// A screen that is named but not built. Shipped deliberately rather than
// left empty: someone who taps a tab and gets a blank page concludes the
// numbers are zero or the app is broken - and "no work for you" is the worst
// possible first impression when the truth is "this is next".
export function NextUp({ title, lead, tab, step, manages = false }: {
  title: string; lead: string;
  tab: "work" | "jobs" | "projects" | "tasks" | "money" | "inbox";
  step?: string; manages?: boolean;
}) {
  return (
    <Screen>
      <AppBar brand right={null} />
      <div className="body">
        <div className="hero"><h1>{title}</h1><p className="lead">{lead}</p></div>
        <Card soft pad>
          <div className="kicker">Not built yet</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            {step ? <>{step}. The database side already exists, so this is a screen away, not a project away. </> : <>This is the next thing we&apos;re making. </>}
            <Link href={manages ? "/projects" : "/work"}>Back to {manages ? "the board" : "work"}</Link>
          </p>
        </Card>
      </div>
      <ExpertTabs current={tab} manages={manages} />
    </Screen>
  );
}
