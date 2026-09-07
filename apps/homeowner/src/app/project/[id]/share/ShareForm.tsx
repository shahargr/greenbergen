"use client";

import { useState } from "react";
import Link from "next/link";
import { publishShare } from "../actions";

// Before / after picker, one line about the contractor, address hidden by
// default. Publishing is a server action; the card itself is public at
// /s/<slug> (no photos there - project-media is private).
export function ShareForm({ projectId, photos, defaultQuote, defaultHide, defaultAfter, contractor }: {
  projectId: string; photos: { id: string; url: string | null; caption: string | null }[]; defaultQuote: string; defaultHide: boolean; defaultAfter: string | null; contractor: string;
}) {
  const [after, setAfter] = useState<string>(defaultAfter ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form action={publishShare} className="stack" onSubmit={() => setBusy(true)}>
      <input type="hidden" name="project" value={projectId} />
      <input type="hidden" name="after_file_id" value={after} />
      <div>
        <div className="field-label">Pick the after photo</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
          {photos.map((p) => (
            <button type="button" key={p.id} onClick={() => setAfter(p.id === after ? "" : p.id)} className="card" style={{ padding: 0, aspectRatio: "1", background: "var(--color-soft-2)", position: "relative", cursor: "pointer", outline: after === p.id ? "2px solid var(--color-accent)" : "none" }} aria-pressed={after === p.id}>
              {p.url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.url} alt={p.caption ?? ""} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              )}
              {after === p.id && <span className="tag tag-accent" style={{ position: "absolute", bottom: 6, left: 6 }}>after</span>}
            </button>
          ))}
          <Link href={`/project/${projectId}/timeline`} className="card" style={{ aspectRatio: "1", display: "grid", placeItems: "center", textDecoration: "none", fontSize: 12, textAlign: "center", padding: 6 }}>+ add<br />after photo</Link>
        </div>
      </div>
      <label className="field">
        <span className="field-label">How was {contractor}?</span>
        <textarea className="input" name="quote" rows={3} defaultValue={defaultQuote} placeholder="Showed up when he said, cleaned up the basement better than he found it, and explained the permit stuff in plain English." />
      </label>
      <label className="radio">
        <input type="checkbox" name="hide" defaultChecked={defaultHide} /><span className="dot" />
        <span>Hide my street address — share the town only</span>
      </label>
      <p className="tiny text-muted" style={{ margin: 0 }}>The public card shows the package, the town, the dates, the community price, {contractor}&apos;s name and your line. Photos stay private to you and {contractor} for now.</p>
      <div className="actions" style={{ padding: 0 }}>
        <button className={`btn btn-primary btn-block  ${busy ? "busy" : ""}`} disabled={busy}>{busy ? <><span className="spin" /> Building your card…</> : "Share with the neighbors"}</button>
        <Link href={`/project/${projectId}`} className="btn btn-ghost btn-block">Maybe later</Link>
      </div>
    </form>
  );
}
