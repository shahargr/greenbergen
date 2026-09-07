import Link from "next/link";
import { getMe } from "@/lib/me";
import { AppBar, Blueprint, Screen } from "@/components/ui";
import { Steps } from "@/components/Illustrations";
import { firstName } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };

// Screen 3 - the three-step orientation. Not a gate: one tap moves on.
export default async function WelcomePage() {
  const me = await getMe();
  const name = me.signed_in ? firstName(me.profile.full_name) : "";
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <div className="kicker">{name ? `You're in, ${name}` : "You're in"}</div>
        <div className="hero">
          <h1>Here&apos;s how a project goes.</h1>
        </div>
        <div className="illus short"><Steps /></div>
        <Blueprint pad>
          <div className="steps">
            <div className="step active">
              <div className="n">1</div>
              <div><div className="t">What would you like to get done?</div><div className="d">Pick a pre-priced package. No typing, no quotes to chase.</div></div>
            </div>
            <div className="step">
              <div className="n">2</div>
              <div><div className="t">Tell us about your home</div><div className="d">Only when a project needs it — address and a couple of photos.</div></div>
            </div>
            <div className="step">
              <div className="n">3</div>
              <div><div className="t">How much would you like to spend?</div><div className="d">Optional. Helps us suggest the right approach. Contractors never see it.</div></div>
            </div>
          </div>
        </Blueprint>
      </div>
      <div className="actions">
        <Link href="/packages" className="btn btn-primary btn-block blueprint">Start with step one</Link>
      </div>
    </Screen>
  );
}
