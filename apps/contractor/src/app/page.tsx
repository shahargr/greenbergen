import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { AppBar, Card, CheckIcon, Screen } from "@shared/ui";
import { loadTagline } from "@shared/catalogue";

export const dynamic = "force-dynamic";

// The pitch, and it has to be an honest one: this is not a lead service and
// there is no bidding. A trade who arrives expecting to undercut someone
// should understand in ten seconds that they are in the wrong place - and a
// trade who is sick of paying for leads should understand they are not.
export default async function Landing() {
  const supabase = await createClient();
  if (await isSignedIn(supabase)) redirect("/work");
  const tagline = await loadTagline();

  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <div className="hero">
          <h1>Work from the people who live here.</h1>
          {/* The community line, editable in Admin (config.public_tagline).
              It used to sit under the logo; the logo now names the app. */}
          {tagline && <p className="step-kicker" style={{ margin: "-4px 0 8px" }}>{tagline}</p>}
          <p className="lead">
            Green Bergen is a real community, not just a marketplace. Neighbours book pre-priced
            packages; you accept the ones you want at the community price.
          </p>
        </div>

        <Card pad>
          <ul className="scope">
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>No bidding, no haggling.</strong><br /><span className="text-muted">The price is published before you see the job. Accept it or pass — nobody undercuts anybody.</span></span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>No lead fees.</strong><br /><span className="text-muted">You never pay to look at work, and you are never one of six people called about the same boiler.</span></span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Scope and photos up front.</strong><br /><span className="text-muted">What is included is written down, and the homeowner supplies the photos, so you can price without driving over.</span></span></li>
            <li><span className="ic"><CheckIcon size={18} /></span><span><strong>Paid directly by the homeowner.</strong><br /><span className="text-muted">Green Bergen never holds your money.</span></span></li>
          </ul>
        </Card>

        <Card soft pad>
          <div className="kicker">Before you can accept</div>
          <p className="small" style={{ margin: "6px 0 0" }}>
            Your trade licence, a general liability certificate, workers&apos; comp and a W-9 — plus a
            look from a person here. Browsing the work needs none of it.
          </p>
        </Card>
      </div>
      <div className="actions">
        <Link href="/join" className="btn btn-primary btn-block">Join as a contractor</Link>
        <Link href="/login" className="btn btn-ghost btn-block">I already have an account</Link>
      </div>
    </Screen>
  );
}
