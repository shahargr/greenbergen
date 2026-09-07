import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { AppBar, Card, Screen } from "@shared/ui";
import { House } from "@shared/Illustrations";

export const dynamic = "force-dynamic";

type RefPreview = { ok: boolean; first?: string; name?: string; line?: string };

// Screen 1 - landing, direct and invited. The invite (?ref=) pre-fills the
// inviter's name only; attribution rides the link into /join silently.
// No member count until the number is impressive: the slot exists
// (SHOW_MEMBER_COUNT) so it can be turned on without a redesign.
const SHOW_MEMBER_COUNT = false;

export default async function Landing({ searchParams }: { searchParams: Promise<{ ref?: string; name?: string }> }) {
  const { ref, name } = await searchParams;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (auth.user && !ref) redirect("/project");

  let inviter: RefPreview | null = null;
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) {
    const { data } = await rpc<RefPreview>(supabase, "homeowner_ref_preview", { p_ref: ref });
    if (data?.ok) inviter = data;
  }
  const joinHref = `/join${ref ? `?ref=${encodeURIComponent(ref)}${name ? `&name=${encodeURIComponent(name)}` : ""}` : ""}`;

  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        {inviter ? (
          <Card pad>
            <div className="row">
              <span className="avatar">{(inviter.name ?? "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
              <div>
                <div><strong>{inviter.name}</strong> invited you.</div>
                <div className="small text-muted">{inviter.line}</div>
              </div>
            </div>
          </Card>
        ) : (
          <div className="kicker">A community, not a marketplace</div>
        )}

        <div className="hero">
          <h1>
            {inviter && name ? <>Welcome, {name}. This is the Bergen community.</> : <>Welcome to the Bergen community.</>}
          </h1>
          <p className="lead">Best-in-class local contractors. Transparent pricing we negotiated together, so you don&apos;t have to.</p>
        </div>

        <div className="illus short">
          <House />
        </div>

        <Card pad={false}>
          <div className="promises">
            <div><div className="t">Pre-priced</div><div className="d">Packages, not quotes</div></div>
            <div><div className="t">Vetted</div><div className="d">Licensed &amp; insured</div></div>
            <div><div className="t">Direct</div><div className="d">You pay the contractor</div></div>
          </div>
        </Card>

        {SHOW_MEMBER_COUNT && (
          <p className="small text-muted center" style={{ margin: 0 }}>
            <strong>—</strong> Bergen homeowners and counting
          </p>
        )}
      </div>
      <div className="actions">
        <Link href={joinHref} className="btn btn-primary btn-block">
          {inviter ? `Join ${inviter.first} in the community` : "Join the community"}
        </Link>
        <Link href="/packages" className="btn btn-ghost btn-block">See the packages first</Link>
        <p className="small text-muted center" style={{ margin: "4px 0 0" }}>Already a member? <Link href="/login">Sign in</Link></p>
      </div>
    </Screen>
  );
}
