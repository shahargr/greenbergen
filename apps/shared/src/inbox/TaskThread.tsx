"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TaskSheet } from "../TaskSheet";
import { shortDate } from "../format";
import { taskNotes, type TaskNote } from "./actions";

// THE THREAD UNDER A TASK ROW.
//
// Shahar: "just created an update, but when i click on the task the update
// does not show below. fix." The row offered Update and Complete and then
// showed nothing of what had been posted - so an update went into the
// database and, as far as the person could see, into a void.
//
// This is the history of the task - every note with its photos and
// recordings - read the moment the row opens and re-read after every entry
// posted from it. It sits inside the row's <details>, finds it, and listens
// for it to open, so a page of twenty-five closed tasks costs nothing until
// one is expanded. The same thread hangs under a message that is ABOUT a
// task, so an update shows wherever the task is met.
export function TaskThread({ projectId, actionId, title }: { projectId: string; actionId: string; title: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [notes, setNotes] = useState<TaskNote[] | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setNotes(await taskNotes(actionId)); } finally { setLoading(false); }
  }, [actionId]);

  useEffect(() => {
    const details = host.current?.closest("details");
    if (!details) { void load(); return; }
    if (details.open) void load();
    const onToggle = () => { if (details.open) void load(); };
    details.addEventListener("toggle", onToggle);
    return () => details.removeEventListener("toggle", onToggle);
  }, [load]);

  return (
    <div ref={host} className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        <TaskSheet projectId={projectId} actionId={actionId} title={title} onPosted={load}
          trigger={<button type="button" className="btn btn-primary small">Update</button>} />
        <TaskSheet projectId={projectId} actionId={actionId} title={title} completeFirst onPosted={load}
          trigger={<button type="button" className="btn btn-secondary small">Complete</button>} />
      </div>

      {notes === null && loading && <div className="tiny text-muted">Loading the history…</div>}
      {notes !== null && notes.length === 0 && <div className="tiny text-muted">Nothing posted on this task yet.</div>}
      {notes !== null && notes.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="tiny text-muted">History · {notes.length}</div>
          {[...notes].reverse().map((c) => (
            <div key={c.id} className="note">
              <div className="tiny text-muted">
                {[c.author, c.created_at ? shortDate(c.created_at.slice(0, 10)) : null].filter(Boolean).join(" · ")}
              </div>
              {c.body && <p className="small" style={{ margin: "2px 0 0", whiteSpace: "pre-wrap" }}>{c.body}</p>}
              {c.files.length > 0 && (
                <div className="stack" style={{ gap: 6, marginTop: 6 }}>
                  {c.files.map((f) => {
                    if (f.kind === "audio") {
                      return f.url
                        ? <audio key={f.file_id} src={f.url} controls preload="none" style={{ width: "100%" }} />
                        : <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>Voice note</p>;
                    }
                    if (f.kind === "photo" && f.url) {
                      // eslint-disable-next-line @next/next/no-img-element
                      return <img key={f.file_id} src={f.url} alt={f.name ?? "Photo"} style={{ width: "100%", borderRadius: 10, display: "block" }} />;
                    }
                    return (
                      <p key={f.file_id} className="tiny text-muted" style={{ margin: 0 }}>
                        {f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.name ?? f.kind}</a> : (f.name ?? f.kind)}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
