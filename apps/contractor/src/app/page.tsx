import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { AppBar, Card, CheckIcon, Screen } from "@shared/ui";
import { SITE_ORIGIN } from "@shared/site";

export const dynamic = "force-dynamic";

// The pitch, and it has to be an honest one: this is not a lead service and
// there is no bidding. A trade who arrives expecting to undercut someone
// should understand in ten seconds that they are in the wrong place - and a
// trade who is sick of paying for leads should understand they are not.
// The name in running text, coloured like the wordmark: green, then ink.
const Brand = () => (
  <span style={{ fontFamily: "var(--font-heading)", fontWeight: 800, letterSpacing: "-0.01em" }}>
    <span style={{ color: "var(--color-brand)" }}>green</span><span style={{ color: "var(--color-text)" }}>bergen</span>
  </span>
);

export default async function Landing() {
  const supabase = await createClient();
  if (await isSignedIn(supabase)) redirect("/work");

  return (
    <Screen>
      {/* The logo leaves this door for the front door (Shahar: "I'm stuck
          in this page, unable to go back to the main landing"). The root
          sends a visitor to the homeowner landing and a member to their
          doors; an absolute address, because this app lives under /pro. */}
      {/* A member logs in from the top right, like the homeowner door;
          the bar at the bottom is for joining only (Shahar, 2026-09-10). */}
      <AppBar brand home={`${SITE_ORIGIN}/`} right={<Link href="/login" className="btn btn-ghost">Log in</Link>} />
      <div className="body">
        <div className="hero">
          <h1>Work from the people who live here.</h1>
          {/* The community line, editable in Admin (config.public_tagline).
              It used to sit under the logo; the logo now names the app. */}
          {/* The trade's own line, not the shared community tagline: that
              one said "community, not a marketplace", and so does the first
              sentence below it (Shahar: remove the duplication). This says
              the two things a contractor came to check. One line on a phone:
              it shrinks with the screen and never wraps. */}
          <p className="step-kicker" style={{ margin: "-4px 0 8px", whiteSpace: "nowrap", letterSpacing: "0.08em", fontSize: "clamp(9.5px, 2.75vw, 11px)" }}>No bidding. No lead fees. Just the work.</p>
          <p className="lead">
            <Brand /> is a community, not a marketplace. Neighbours book pre-priced packages at a
            fair price, and you can accept or pass on the ones you want.
          </p>
        </div>

        <Card pad>
          <ul className="scope">
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>No bidding, no haggling.</strong><br /><span className="text-muted">The price is published before you see the job. Accept it or pass — nobody undercuts anybody.</span></span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>No lead fees.</strong><br /><span className="text-muted">You never pay to look at work and submit your request to deliver it.</span></span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Scope and photos up front.</strong><br /><span className="text-muted">What is included is written down, and the homeowner supplies the photos, so you can price without driving over.</span></span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Milestone payments are automatic.</strong><br /><span className="text-muted"><Brand /> never holds your money.</span></span></li>
          </ul>
        </Card>

        <Card soft pad>
          <div className="kicker">Before you can accept</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            Some jobs require a license, insurance and verification. Upload your documents and that&apos;s it.
          </p>
        </Card>
      </div>
      <div className="actions">
        <Link href="/join" className="btn btn-primary btn-block">Join as a contractor</Link>
      </div>
    </Screen>
  );
}
