import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@shared/supabase/server";
import { rpc } from "@shared/rpc";
import { shortDate } from "@shared/format";
import { stopwatch } from "@shared/perf";
import { AppBar, Card, Screen } from "@shared/ui";
import { getBoard } from "@/lib/board";
import { AddEvidence } from "./AddEvidence";

export const dynamic = "force-dynamic";

// Every line the work was priced from, with the proof against it. A bid is
// priced from these lines and this is where they are shown to have been
// delivered - so the same list settles both halves of the argument.
//
// Uploading is open to any member, on purpose: rulebook 14 wants the photo
// from whoever is standing in front of the work.

type Evidence = {
  file_id: string; file_name: string; kind: string | null; mime: string | null;
  bucket: string; path: string; role: string; at: string; who: string | null;
};

// Exactly the keys portal_scope_evidence returns - verified against live
// output. It does not return owner_summary or audience, so a line written in
// the owner's words reads here as the scope line it became.
type Line = {
  id: string; trade: string | null; item: string;
  category: string | null; is_required: boolean; authority: string;
  evidence: Evidence[];
};

export default async function ScopeEvidencePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ line?: string }>;
}) {
  const { id } = await params;
  const { line: openLine } = await searchParams;

  const w = stopwatch("/project/[id]/scope/evidence");
  const supabase = await createClient();
  const [board, { data }] = await Promise.all([
    w.step("board", () => getBoard()),
    w.step("scope", () => rpc<Line[]>(supabase, "portal_scope_evidence", { p_project: id })),
  ]);
  if (!board.signed_in) redirect(`/login?next=${encodeURIComponent(`/project/${id}/scope/evidence`)}`);

  const seat = board.seats.find((s) => s.project_id === id);
  if (!seat) notFound();
  const lines = data ?? [];

  // One signed URL per attached file. They are asked for together, and only
  // this screen pays for them - the scope wizard never touches storage.
  const urls = new Map<string, string>();
  await w.step("urls", async () => {
    const files = lines.flatMap((l) => l.evidence ?? []);
    await Promise.all(files.map(async (e) => {
      const { data: signed } = await supabase.storage.from(e.bucket).createSignedUrl(e.path, 3600);
      if (signed?.signedUrl) urls.set(e.file_id, signed.signedUrl);
    }));
  });
  w.done();

  const withProof = lines.filter((l) => (l.evidence?.length ?? 0) > 0).length;
  const byTrade = new Map<string, Line[]>();
  for (const l of lines) {
    const k = l.trade ?? "Other";
    byTrade.set(k, [...(byTrade.get(k) ?? []), l]);
  }

  return (
    <Screen>
      <AppBar back={`/project/${id}/scope`} title="Scope & evidence" sub={seat.project_name} />
      <div className="body">
        {lines.length === 0 ? (
          <Card soft pad>
            <div className="card-title">Nothing in scope yet.</div>
            <p className="small text-muted" style={{ margin: "6px 0 0" }}>
              Put the trades and their lines in scope first — <Link href={`/project/${id}/scope`}>that is the scope screen</Link>.
            </p>
          </Card>
        ) : (
          <>
            <div className="kicker">{withProof} of {lines.length} shown done</div>
            <p className="small text-muted" style={{ margin: "0 0 4px" }}>
              Add a photo against a line and it stands as the proof that line was delivered. Take the
              &ldquo;before&rdquo; while you still can — the items worth arguing about later are the ones
              that get buried.
            </p>

            {[...byTrade.entries()].map(([trade, rows]) => (
              <section className="stack" style={{ gap: 6, marginTop: 12 }} key={trade}>
                <div className="divider-label">
                  {trade} · {rows.filter((r) => (r.evidence?.length ?? 0) > 0).length}/{rows.length}
                </div>
                {rows.map((l) => {
                  const shots = l.evidence ?? [];
                  return (
                    <Card pad className="tight" key={l.id}>
                      <details open={openLine === l.id}>
                        <summary className="between" style={{ gap: 8, cursor: "pointer", alignItems: "baseline" }}>
                          <span className="grow small" style={{ minWidth: 0 }}>
                            <span style={{ color: shots.length ? "var(--color-ok)" : "var(--muted)", marginRight: 6 }}>
                              {shots.length ? "●" : "○"}
                            </span>
                            {l.item.length > 140 ? `${l.item.slice(0, 140)}…` : l.item}
                          </span>
                          <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>
                            {shots.length ? `${shots.length} file${shots.length === 1 ? "" : "s"}` : "no proof"}
                          </span>
                        </summary>

                        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
                          {(l.is_required || l.category) && (
                            <p className="tiny text-muted" style={{ margin: 0 }}>
                              {[l.is_required ? "Required" : null, l.category].filter(Boolean).join(" · ")}
                            </p>
                          )}
                          {shots.length > 0 && (
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
                              {shots.map((e) => {
                                const url = urls.get(e.file_id);
                                const isImage = (e.mime ?? "").startsWith("image/") || e.kind === "photo";
                                return (
                                  <a key={e.file_id} href={url ?? "#"} target="_blank" rel="noreferrer"
                                    title={`${e.file_name} · ${e.role}${e.who ? ` · ${e.who}` : ""}`}
                                    style={{ display: "grid", gap: 3, textDecoration: "none", color: "inherit", minWidth: 0 }}>
                                    {isImage && url ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={url} alt={e.file_name}
                                        style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 10 }} />
                                    ) : (
                                      <span style={{ display: "grid", placeItems: "center", width: "100%", aspectRatio: "1 / 1", borderRadius: 10, background: "var(--color-soft)", fontSize: 20 }}>
                                        {e.kind === "video" ? "🎬" : e.kind === "audio" ? "🎙" : "📄"}
                                      </span>
                                    )}
                                    <span className="tiny text-muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                      {e.role} · {shortDate(e.at)}
                                    </span>
                                  </a>
                                );
                              })}
                            </div>
                          )}
                          <AddEvidence projectId={id} scopeItemId={l.id} />
                        </div>
                      </details>
                    </Card>
                  );
                })}
              </section>
            ))}
          </>
        )}
      </div>
    </Screen>
  );
}
