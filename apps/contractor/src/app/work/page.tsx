import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { AppBar, Card, Notice, Screen, ShellIcons } from "@shared/ui";
import { stopwatch } from "@shared/perf";
import { WorkTabs } from "@/components/WorkTabs";
import { ReadyCard } from "@/components/ReadyCard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work" };

// The first tab. Today it is the honest status of the application plus the
// counts; the offer feed lands here in step 3 (contractor_offers over the
// existing homeowner_offers, town-only). Nothing on this screen pretends
// to work: a contractor should never tap something that does nothing.
export default async function WorkPage() {
  const w = stopwatch("/work");
  const me = await w.step("me", () => getMe());
  w.done();
  if (!me.signed_in) redirect("/login?next=/work");

  const first = me.profile.full_name?.trim().split(" ")[0] ?? null;

  return (
    <Screen>
      <AppBar brand right={<ShellIcons gearHref="/business" inboxHref="/inbox" />} />
      <div className="body">
        {me.missing && <Notice title="Preview mode">The contractor migration has not been applied to this database yet, so your profile cannot be read.</Notice>}
        {me.degraded && <Notice kind="error" title="We couldn&apos;t load your account just now.">Nothing is lost. <Link href="/work">Try again</Link>, and if it keeps happening tell us.</Notice>}

        <div className="hero">
          <h1>{first ? `Welcome, ${first}.` : "Welcome."}</h1>
          <p className="lead">
            {me.can_accept
              ? "You're approved. Work in your trades and towns shows up here."
              : "Work in your trades will show up here. You can look now; accepting needs your paperwork."}
          </p>
        </div>

        <ReadyCard me={me} />

        {me.trades.length > 0 && (
          <section className="stack" style={{ gap: 6 }}>
            <div className="divider-label">Your trades</div>
            <div className="chips">
              {me.trades.map((t) => <span key={t.trade} className="tag tag-neutral" style={{ padding: "7px 12px", fontSize: 12 }}>{t.trade}</span>)}
            </div>
          </section>
        )}

        {/* The feed is step 3. Say so rather than showing an empty list that
            looks like "no work for you". */}
        <Card soft pad>
          <div className="kicker">Next</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            The offer feed opens here once your trades and documents are in — every job in your trades,
            with the scope, the photos and the community price. You&apos;ll see the town; the address is
            shared the moment you accept.
          </p>
        </Card>
      </div>
      <WorkTabs current="work" offers={me.counts.open_offers} />
    </Screen>
  );
}
