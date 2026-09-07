import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { AppBar, Card, Notice, Screen, StepKicker } from "@shared/ui";
import { addHome } from "@/app/project/[id]/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add a home" };

// Claim another home without ordering anything. The agreement's quota
// decides (create_home_asset); the page only says so.
export default async function NewHomePage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const { error, next } = await searchParams;
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/homes/new");
  const q = me.home_quota;
  const canAdd = q?.can_add ?? true;
  return (
    <Screen>
      <AppBar back="/project" title="Add a home" />
      <form className="body" action={addHome}>
        <StepKicker>Your homes · {me.homes.length} so far</StepKicker>
        <div className="hero">
          <h1>Another address.</h1>
          <p className="lead">A second home, a rental, a parent&apos;s place. Every job and plan lives on the home it&apos;s for.</p>
        </div>
        {!canAdd && (
          <Notice title="Your agreement is full.">
            It covers {q?.allowed ?? 1} home{(q?.allowed ?? 1) === 1 ? "" : "s"} and you have {q?.have ?? me.homes.length}. Ask us to extend it and this page opens up.
          </Notice>
        )}
        <label className="field">
          <span className="field-label">Street address</span>
          <input className={`input ${error ? "invalid" : ""}`} name="address" autoComplete="street-address" placeholder="22 Oak Ave, Tenafly, NJ 07670" required disabled={!canAdd} autoFocus />
          <p className="hint">Bergen County only.</p>
        </label>
        <label className="field">
          <span className="field-label">Call it <span className="text-muted">(optional)</span></span>
          <input className="input" name="name" placeholder="Mom's house" disabled={!canAdd} />
        </label>
        <input type="hidden" name="next" value={next ?? "/project"} />
        {error && <Notice kind="error">{error}</Notice>}
        {me.missing && <Notice title="Preview mode">The database migration has not been applied yet, so homes cannot be added.</Notice>}
        <Card soft pad>
          <div className="small">Adding a home does not order anything. Pick a package afterwards and choose this home, or plan one for later.</div>
        </Card>
        <div className="actions" style={{ padding: 0, marginTop: "auto" }}>
          <button className="btn btn-primary btn-block" disabled={!canAdd}>Add this home</button>
          <Link href="/project" className="btn btn-ghost btn-block">Not now</Link>
        </div>
      </form>
    </Screen>
  );
}
