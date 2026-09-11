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

// TODAY'S VISIT, AND THE ONE BEFORE IT.
//
// Shahar (2026-09-11): "The log site visit should read today's visit, and
// either be empty or have words below for what's been logged. today's visit
// should be editable. if no visit happened yet, show last visit info. build a
// UI design that don't take too much space on the screen but allows to see
// both this and last visit if needed."
//
// So the block is always ONE card - today - and it is either the empty box
// you write in or what you already wrote, editable in place. The visit before
// it is a single collapsed line underneath: enough to know when someone was
// last here, one tap to read it, no space when you do not care. Everything
// older is behind a second line.
export function SiteVisits({ projectId, visits, urls, canLog, today }: {
  projectId: string;
  visits: Visit[];
  urls: Record<string, string>;
  canLog: boolean;
  today: string;
}) {
  const mine = visits.filter((v) => v.on_date === today && v.mine);
  const todays = mine[0] ?? visits.find((v) => v.on_date === today) ?? null;
  const earlier = visits.filter((v) => v.id !== todays?.id);
  const last = earlier[0] ?? null;
  const older = earlier.slice(1);

  const [editing, setEditing] = useState(false);

  return (
    <section className="stack" style={{ gap: 8 }}>
      <div className="divider-label">Today · {shortDate(today)}</div>

      {/* TODAY. The box you write in, or what you wrote. */}
      {todays && !editing ? (
        <div className="card pad tight">
          <div className="between" style={{ alignItems: "flex-start" }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="tiny text-muted">{todays.who ?? "someone"}{todays.mine ? " · you" : ""}</div>
              {todays.note
                ? <p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{todays.note}</p>
                : <p className="small text-muted" style={{ margin: "4px 0 0" }}>No words — just what is attached.</p>}
            </div>
          </div>
          <Files files={todays.files} urls={urls} top={!!todays.note} />
          {todays.can_edit && (
            <div className="row" style={{ gap: 6, marginTop: 10 }}>
              <button type="button" className="btn btn-ghost small" onClick={() => setEditing(true)}>Edit</button>
              <form action={deleteVisit.bind(null, projectId, todays.id)}
                onSubmit={(e) => { if (!confirm("Remove today's visit? The photos stay on the project.")) e.preventDefault(); }}>
                <button className="btn btn-ghost small btn-danger">Delete</button>
              </form>
            </div>
          )}
        </div>
      ) : todays && editing ? (
        <div className="card pad tight">
          <VisitForm projectId={projectId} visit={todays} onCancel={() => setEditing(false)} />
        </div>
      ) : canLog ? (
        <div className="card pad tight">
          <VisitForm projectId={projectId} onCancel={null} />
        </div>
      ) : (
        <div className="card soft pad"><div className="small">Nothing logged today.</div></div>
      )}

      {/* THE ONE BEFORE IT. A line, until you want it. */}
      {last && (
        <details className="visit-prev">
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>
              Last visit · {shortDate(last.on_date)} · {last.who ?? "someone"}
            </span>
            <span className="mark" aria-hidden />
          </summary>
          <div style={{ padding: "0 12px 12px" }}>
            {last.note && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{last.note}</p>}
            <Files files={last.files} urls={urls} top={!!last.note} />
          </div>
        </details>
      )}

      {older.length > 0 && (
        <details className="visit-prev">
          <summary>
            <span className="grow" style={{ minWidth: 0 }}>
              {older.length} earlier {older.length === 1 ? "visit" : "visits"}
            </span>
            <span className="mark" aria-hidden />
          </summary>
          <div className="stack" style={{ gap: 10, padding: "0 12px 12px" }}>
            {older.map((v) => (
              <div key={v.id}>
                <div className="tiny text-muted">{shortDate(v.on_date)} · {v.who ?? "someone"}</div>
                {v.note && <p className="small" style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{v.note}</p>}
                <Files files={v.files} urls={urls} top={!!v.note} />
              </div>
            ))}
          </div>
        </details>
      )}

      {!last && !todays && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          Nothing logged on this site yet. A visit is the record that you were here and what you saw.
        </p>
      )}
    </section>
  );
}

function Files({ files, urls, top }: {
  files: Visit["files"]; urls: Record<string, string>; top: boolean;
}) {
  if (files.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8, marginTop: top ? 10 : 4 }}>
      {files.map((f) => {
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
  );
}

// One box for both jobs. Writing today's visit needs no date - it is today;
// back-dating one is a rarer thing and hides behind a line rather than
// costing a field on every visit.
function VisitForm({ projectId, visit, onCancel }: {
  projectId: string; visit?: Visit; onCancel: (() => void) | null;
}) {
  const [files, setFiles] = useState<Attached[]>([]);
  const [text, setText] = useState(visit?.note ?? "");
  const [otherDay, setOtherDay] = useState(false);
  const ready = text.trim().length > 0 || files.length > 0;
  const action = visit ? editVisit.bind(null, projectId, visit.id) : logVisit.bind(null, projectId);

  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <textarea name="note" rows={2} className="input" value={text} onChange={(e) => setText(e.target.value)}
        placeholder="What did you see? Who was here, what moved, what is blocked…" />
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />

      {!visit && otherDay && (
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
          {visit ? "Save the change" : files.length > 0 && !text.trim() ? "Log what I attached" : "Log today's visit"}
        </button>
        {onCancel && <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>

      {!visit && !otherDay && (
        <button type="button" className="tiny text-muted"
          style={{ background: "none", border: 0, padding: 0, textAlign: "left", cursor: "pointer", textDecoration: "underline" }}
          onClick={() => setOtherDay(true)}>
          This was not today
        </button>
      )}
    </form>
  );
}
