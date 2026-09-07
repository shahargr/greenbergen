import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { getMe } from "@/lib/me";
import { getBooking } from "@/lib/booking";
import { shortDate } from "@shared/format";
import { AppBar, Avatar, Card, Notice, Screen } from "@shared/ui";
import { inviteContractor, inviteToProject } from "../actions";
import { CopyLink } from "./CopyLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "People" };

// Who can see this job, and inviting more: a co-owner (spouse, partner), a
// viewer (a designer, a tenant), or the contractor. Existing accounts are
// invited straight to the job (project_people / portal_invite_to_project);
// a contractor who is not on Green Bergen yet gets a join link (invite_peer).
type People = {
  bounded: boolean;
  members: { id: string; name: string; project_role: string | null; role: string; rank: number; contract: string | null; is_company: boolean; has_login: boolean; status: string }[];
  pending: { id: string; email: string | null; role: string; project_role: string | null; expires_at: string }[];
};

const PORTAL = process.env.NEXT_PUBLIC_PORTAL_URL ?? "https://greenbergen.vercel.app";

export default async function PeoplePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string; token?: string; who?: string }> }) {
  const { id } = await params;
  const { error, ok, token, who } = await searchParams;
  const me = await getMe();
  if (!me.signed_in) redirect(`/login?next=/project/${id}/people`);
  const { booking: b, missing } = await getBooking(id);
  if (missing) redirect("/project");
  if (!b) notFound();
  const supabase = await createClient();
  const { data: people } = await rpc<People>(supabase, "project_people", { p_project_id: id });
  const members = people?.members ?? [];
  const pending = people?.pending ?? [];
  const canInvite = b.is_owner;
  const inviteLink = token ? `${PORTAL}/join?invite=${encodeURIComponent(token)}` : null;

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="People" sub={`${b.package?.name ?? "This job"} · ${b.address?.split(",")[0] ?? ""}`} />
      <div className="body">
        {error && <Notice kind="error">{error}</Notice>}
        {ok && <div className="banner-ok">Invitation sent to {ok}. They&apos;ll see it in their inbox and nothing changes until they accept.</div>}
        {inviteLink && (
          <Card pad>
            <div className="card-title">A join link for {who}</div>
            <p className="small text-muted" style={{ margin: "4px 0 8px" }}>Text or email it. It signs them up as a contractor on Green Bergen; once they&apos;re in, invite them to this job below.</p>
            <CopyLink link={inviteLink} />
          </Card>
        )}

        <Card pad={false}>
          <div className="kicker" style={{ padding: "14px 16px 4px" }}>On this job</div>
          {members.map((m) => (
            <div className="person" key={m.id}>
              <Avatar name={m.name} ghost={!m.has_login} />
              <div className="grow">
                <div className="name">{m.name}</div>
                <div className="meta">{roleLabel(m.project_role, m.role)}{m.contract ? ` · ${m.contract}` : ""}{m.status !== "active" ? ` · ${m.status}` : ""}{!m.has_login && !m.is_company ? " · no login yet" : ""}</div>
              </div>
            </div>
          ))}
          {members.length === 0 && <p className="small text-muted" style={{ padding: "0 16px 14px" }}>Just you so far.</p>}
          {pending.length > 0 && (
            <>
              <div className="kicker" style={{ padding: "6px 16px 4px" }}>Invited, not yet accepted</div>
              {pending.map((p) => (
                <div className="person" key={p.id}>
                  <Avatar name={p.email} ghost />
                  <div className="grow"><div className="name">{p.email ?? "By phone"}</div><div className="meta">as {roleLabel(p.project_role, p.role)} · expires {shortDate(p.expires_at)}</div></div>
                </div>
              ))}
            </>
          )}
        </Card>

        {canInvite ? (
          <>
            <Card pad>
              <div className="card-title">Invite someone who has an account</div>
              <p className="small text-muted" style={{ margin: "4px 0 10px" }}>Their email or phone, exactly as they signed up. They accept from their inbox; nobody is added silently.</p>
              <form action={inviteToProject} className="stack">
                <input type="hidden" name="project" value={id} />
                <label className="field"><span className="field-label">Email</span><input className="input" name="email" type="email" inputMode="email" placeholder="them@example.com" /></label>
                <label className="field"><span className="field-label">or phone</span><input className="input" name="phone" type="tel" inputMode="tel" placeholder="(201) 555-0100" /></label>
                <div className="seg" role="radiogroup" aria-label="Seat">
                  <label className="seg-opt"><input type="radio" name="seat" value="peer" />Co-owner</label>
                  <label className="seg-opt"><input type="radio" name="seat" value="viewer" defaultChecked />Viewer</label>
                  <label className="seg-opt"><input type="radio" name="seat" value="contractor" />Contractor</label>
                </div>
                <p className="tiny text-muted" style={{ margin: 0 }}>Co-owner sees and does everything you do, money included. Viewer sees the job, not the money. Contractor is the seat the pro works from.</p>
                <label className="field"><span className="field-label">A note <span className="text-muted">(optional)</span></span><input className="input" name="note" placeholder="Mom, this is the water heater job." /></label>
                <button className="btn btn-primary btn-block">Send the invitation</button>
              </form>
            </Card>

            <Card pad soft>
              <div className="card-title">Bring a contractor onto Green Bergen</div>
              <p className="small text-muted" style={{ margin: "4px 0 10px" }}>Someone you already trust who isn&apos;t a member. You get a link to send them; they sign up as a contractor and can then take this job at the community price.</p>
              <form action={inviteContractor} className="stack">
                <input type="hidden" name="project" value={id} />
                <label className="field"><span className="field-label">Their name</span><input className="input" name="name" placeholder="Volt & Sons" /></label>
                <label className="field"><span className="field-label">Email <span className="text-muted">(optional)</span></span><input className="input" name="email" type="email" inputMode="email" placeholder="them@example.com" /></label>
                <button className="btn btn-secondary btn-block">Make the join link</button>
              </form>
            </Card>
          </>
        ) : (
          <Notice>Only the homeowner can invite people to this job.</Notice>
        )}
        <p className="tiny text-muted" style={{ margin: 0 }}>Access follows the rules in your agreement: a seat on the job shows the scope, photos and timeline; only co-owners see payments. <Link href={`/project/${id}`}>Back to the job</Link>.</p>
      </div>
    </Screen>
  );
}

const roleLabel = (projectRole: string | null, role: string) =>
  projectRole === "asset owner" || role === "owner" ? "Owner" : projectRole === "contractor" ? "Contractor" : role === "manager" ? "Manager" : role === "collaborator" ? "Collaborator" : "Viewer";
