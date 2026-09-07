import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { dollars, shortDay, shortName } from "@shared/format";
import { AppBar, Avatar, Card, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";

export const dynamic = "force-dynamic";

type Share = {
  slug: string; package: string; tile_title: string; illustration: string; town: string | null; address: string | null; quote: string | null;
  posted_at: string; accepted_at: string | null; done_at: string | null; price_cents: number; shared_by: string | null; ref: string;
  contractor: { name: string; jobs: number; rating: { score: number; provisional: boolean } | null } | null;
};

// Screen 16b - what a neighbor sees. Public, anon: the card plus the
// inviter's referral carried into /join.
export default async function SharedCard({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const supabase = await createClient();
  const { data: s } = await rpc<Share>(supabase, "homeowner_share", { p_slug: slug });
  if (!s) notFound();
  const by = shortName(s.shared_by);
  const first = s.shared_by?.split(" ")[0] ?? "A neighbor";
  const joinHref = `/join?ref=${encodeURIComponent(s.ref)}`;
  return (
    <Screen>
      <AppBar brand right={<span className="tag tag-neutral">Shared by {by}</span>} />
      <div className="body">
        <div className="share-card">
          <div className="ba">
            <div><span className="lbl">Before</span><Illustration name={s.illustration} className="text-muted" /></div>
            <div><span className="lbl">After</span><Illustration name="check" className="text-muted" /></div>
          </div>
          <div style={{ padding: 14 }}>
            <div className="between">
              <div className="card-title" style={{ fontSize: 20 }}>{s.package}</div>
              {s.town && <span className="tag tag-accent">{s.town}</span>}
            </div>
            <div className="small text-muted" style={{ marginTop: 4 }}>
              Booked {shortDay(s.posted_at)}{s.done_at ? ` · done ${shortDay(s.done_at)}` : ""} · community price {dollars(s.price_cents)}
            </div>
            {s.quote && <blockquote style={{ margin: "12px 0" }}>&ldquo;{s.quote}&rdquo;</blockquote>}
            {s.contractor && (
              <div className="person" style={{ padding: 0 }}>
                <Avatar name={s.contractor.name} />
                <div><div className="name">{s.contractor.name}</div><div className="meta">{s.contractor.jobs} job{s.contractor.jobs === 1 ? "" : "s"} in the community{s.contractor.rating && !s.contractor.rating.provisional ? ` · ${s.contractor.rating.score}` : ""}</div></div>
              </div>
            )}
          </div>
        </div>
        <Card pad>
          <h2>{first}&apos;s inviting you to the Bergen community.</h2>
          <p className="text-muted" style={{ margin: 0 }}>Same contractors, same pre-negotiated prices. Three fields to join.</p>
        </Card>
      </div>
      <div className="actions">
        <Link href={joinHref} className="btn btn-primary btn-block">Join with {first}&apos;s invite</Link>
        <Link href="/packages" className="btn btn-ghost btn-block">See what a {s.tile_title.toLowerCase()} costs</Link>
      </div>
    </Screen>
  );
}
