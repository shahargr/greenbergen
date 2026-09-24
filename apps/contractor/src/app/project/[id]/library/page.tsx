import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { AppBar, Notice, Screen } from "@shared/ui";
import { getBoard, runs } from "@/lib/board";
import { LibraryView, type Folder, type LibFile } from "./LibraryView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Library" };

type Lib = {
  ok: boolean; reason?: string;
  folders: Folder[]; loose: LibFile[]; trades: string[] | null;
};

// THE PROJECT LIBRARY (Shahar, 2026-09-24): "project library will hold
// deliveries by trades by order... enable a folder like view, where I can
// drag and drop files here", and "the system should be smart enough to show
// the files by scanning all existing contracts and proposals... and even if
// they are not attached to anything."
//
// The database does the scanning (portal_library, migration 228): each
// folder fills from hand-filings, from its trade walked through every
// file's links, or - for the Proposals and Signed contracts shelves - from
// everything hanging on a bid package or a contract. What lands nowhere
// shows at the end anyway, waiting to be filed. This page only signs the
// URLs so every file opens with a tap.
export default async function LibraryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [board, { data, error }] = await Promise.all([
    getBoard(),
    supabase.rpc("portal_library", { p_project: id }),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/library`)}`);
  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  // A failed CALL is not a refusal, and must not read like one: the first
  // deploy crashed on a bad column and the fallback text blamed permissions.
  const lib = (data ?? { ok: false, reason: error ? `The library did not load: ${error.message}` : undefined }) as Lib;
  if (!lib.ok || !runs(seat)) {
    return (
      <Screen>
        <AppBar back={`/project/${id}`} title="Library" />
        <div className="body">
          <Notice kind="error">{lib.reason ?? "This project's library is not yours to see."}</Notice>
        </div>
      </Screen>
    );
  }

  // One signed URL per stored file, per bucket, so a row is a click and not
  // a fetch. An hour is plenty - the page re-signs on every load.
  const all = [...(lib.folders ?? []).flatMap((f) => f.files), ...(lib.loose ?? [])];
  const byBucket = new Map<string, string[]>();
  for (const f of all) {
    if (!byBucket.has(f.bucket)) byBucket.set(f.bucket, []);
    const paths = byBucket.get(f.bucket)!;
    if (!paths.includes(f.path)) paths.push(f.path);
  }
  const urls: Record<string, string> = {};
  await Promise.all([...byBucket.entries()].map(async ([bucket, paths]) => {
    const { data: signed } = await supabase.storage.from(bucket).createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.signedUrl && s.path) urls[`${bucket}/${s.path}`] = s.signedUrl;
  }));

  return (
    <Screen>
      <AppBar back={`/project/${id}`} title="Library" sub={seat.project_name ?? undefined} />
      <div className="body">
        <LibraryView projectId={id} folders={lib.folders ?? []} loose={lib.loose ?? []}
          trades={lib.trades ?? []} urls={urls} />
      </div>
    </Screen>
  );
}
