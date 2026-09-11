"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";
import { shortDate } from "@shared/format";
import { logVisit, editVisit, deleteVisit } from "./actions";

export type Visit = {
  id: string; on_date: string; at: string; note: string | null;
  who: string | null; contact_id: string | null; mine: boolean; can_edit: boolean;
  files: { file_id: string; name: string | null; kind: string | null; bucket: string; path: string }[];
};

// THE SITE VISIT LOG. Shahar (2026-09-11): "log a site visit / allow to add
// voice / text / files-image. after logged show the line, and allow to edit
// it / delete it."
//
// One box, the same Evidence picker every other screen uses (camera, file,
// voice note), and a day that defaults to today because most visits are
// written up from the driveway. Then the lines, newest first, each one
// openable into the same box to correct it.
//
// The delete is a confirm and not a drawer: an entry you did not mean to
// write is not a decision worth two screens.
export function SiteVisits({ projectId, visits, urls, canLog }: {
  projectId: string;
  visits: Visit[];
  urls: Record<string, string>;
  canLog: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <section className="stack" style={{ gap: 10 }}>
      <div className="divider-label">Site visits{visits.length > 0 ? ` · ${visits.length}` : ""}</div>

      {canLog && !open && (
        <button type="button" className="btn btn-primary btn-block" onClick={() => setOpen(true)}>
          Log a site visit
        </button>
      )}

      {canLog && open && (
        <VisitForm projectId={projectId} onCancel={() => setOpen(false)} />
      )}

      {visits.length === 0 && (
        <div className="card soft pad"><div className="small">Nothing logged here yet. A visit is the record that you were on site and what you saw.</div></div>
      )}

      {visits.map((v) => (
        <div className="card pad tight" key={v.id}>
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tiny text-muted">
                {[shortDate(v.on_date), v.who ?? "someone", v.mine ? "you" : null].filter(Boolean).join(" · ")}
              </div>
              {v.note && <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{v.note}</p>}
            </div>
          </div>

          {v.files.length > 0 && (
            <div className="stack" style={{ gap: 8, marginTop: v.note ? 10 : 4 }}>
              {v.files.map((f) => {
                const url = urls[f.path];
                if (f.kind === "audio") {
                  return url
                    ? <audio key={f.file_id} src={url} controls preload="none" style={{ width: "100%" }} />
                    : <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>Voice note</p>;
                }
                if (f.kind === "photo") {
                  return url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img key={f.file_id} src={url} alt={f.name ?? "Photo"} style={{ width: "100%", borderRadius: 10, display: "block" }} />
                    : <div key={f.file_id} className="skel" style={{ aspectRatio: "4/3" }} />;
                }
                return (
                  <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>
                    {url ? <a href={url} target="_blank" rel="noreferrer">{f.name ?? f.kind}</a> : (f.name ?? f.kind)}
                  </p>
                );
              })}
            </div>
          )}

          {v.can_edit && editing !== v.id && (
            <div className="row" style={{ gap: 6, marginTop: 10 }}>
              <button type="button" className="btn btn-ghost small" onClick={() => setEditing(v.id)}>Edit</button>
              <form action={deleteVisit.bind(null, projectId, v.id)}
                onSubmit={(e) => { if (!confirm("Remove this visit? The photos stay on the project.")) e.preventDefault(); }}>
                <button className="btn btn-ghost small btn-danger">Delete</button>
              </form>
            </div>
          )}

          {v.can_edit && editing === v.id && (
            <div style={{ marginTop: 10 }}>
              <VisitForm projectId={projectId} visit={v} onCancel={() => setEditing(null)} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

// One box for both jobs. Writing a new visit gets the day; correcting one
// does not, because the day it happened is not what you came to fix.
function VisitForm({ projectId, visit, onCancel }: {
  projectId: string; visit?: Visit; onCancel: () => void;
}) {
  const [files, setFiles] = useState<Attached[]>([]);
  const [text, setText] = useState(visit?.note ?? "");
  const ready = text.trim().length > 0 || files.length > 0;
  const action = visit ? editVisit.bind(null, projectId, visit.id) : logVisit.bind(null, projectId);

  return (
    <form action={action} className="stack" style={{ gap: 10 }}>
      <textarea name="note" rows={3} className="input" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="What did you see? Who was here, what moved, what is blocked…" />
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />

      {!visit && (
        <label className="field" style={{ marginBottom: 0 }}>
          <span className="field-label">Which day</span>
          <input className="input" name="on_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)}
            max={new Date().toISOString().slice(0, 10)} />
        </label>
      )}

      <Evidence projectId={projectId} caption="Site visit" folder="visits" onChange={setFiles}
        accept="image/*,video/*,application/pdf,audio/*" />

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary grow" disabled={!ready}>
          {visit ? "Save the change" : files.length > 0 && !text.trim() ? "Log what I attached" : "Log the visit"}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
