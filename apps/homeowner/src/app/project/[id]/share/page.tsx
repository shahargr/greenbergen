import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getBooking, signedUrls } from "@/lib/booking";
import { shortDate } from "@/lib/format";
import { AppBar, Blueprint, Notice, Screen } from "@/components/ui";
import { ShareForm } from "./ShareForm";
import { ShareLink } from "./ShareLink";

export const dynamic = "force-dynamic";
export const metadata = { title: "Share your project" };

// Screen 16a - the completion moment. Photos + a line about the contractor,
// street address hidden by default; the share carries the owner's invite.
export default async function SharePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; slug?: string }> }) {
  const { id } = await params;
  const { error, slug } = await searchParams;
  const { booking: b, missing, supabase } = await getBooking(id);
  if (missing) redirect("/project");
  if (!b || !b.is_owner) notFound();
  const photos = b.files.filter((f) => f.kind === "photo");
  const urls = await signedUrls(supabase, photos.map((p) => p.path));
  const first = b.contractor?.person?.split(" ")[0] ?? "the contractor";
  // Where this app is served: the explicit env, else the Vercel domain.
  const base = process.env.NEXT_PUBLIC_APP_URL
    ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const shareSlug = slug ?? b.share.slug;
  const done = b.state === "done";

  return (
    <Screen>
      <AppBar back={`/project/${id}`} />
      <div className="body">
        <div className="kicker">{done ? `${b.progress.nodes.find((n) => n.kind === "done")?.at ? `Inspection passed · ${shortDate(b.done_at)}` : `Done · ${shortDate(b.done_at)}`}` : "Almost there"}</div>
        <div className="hero">
          <h1>{done ? b.package?.milestones.find((m) => m.kind === "done")?.trigger_description ?? "Done." : "Share it when the work is done."}</h1>
          <p className="lead">{done ? `Tell the block — your share carries an invite and gives ${first} the next job.` : "The share card opens once the last step is marked."}</p>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        {shareSlug && b.share.shared_at && (
          <Blueprint pad>
            <div className="kicker">Your card is live</div>
            <ShareLink url={`${base}/s/${shareSlug}?ref=${encodeURIComponent(b.owner ? "" : "")}`.replace(/\?ref=$/, "")} />
            <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>Neighbors who join from it are counted as yours.</p>
          </Blueprint>
        )}
        {done && (
          <ShareForm projectId={id} photos={photos.map((p) => ({ id: p.id, url: urls[p.path] ?? null, caption: p.caption }))}
            defaultQuote={b.share.quote ?? ""} defaultHide={b.share.hide_address} defaultAfter={b.share.after_file_id} contractor={first} />
        )}
        {!done && (
          <div className="actions" style={{ padding: 0 }}>
            <Link href={`/project/${id}`} className="btn btn-secondary btn-block">Back to my project</Link>
          </div>
        )}
      </div>
    </Screen>
  );
}
