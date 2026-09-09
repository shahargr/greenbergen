"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

// The update box, with proof.
//
// It sits inside the server-action form and does one job the form cannot: it
// holds the ids of files that were uploaded WHILE the note was being written,
// and hands them over in a hidden field when Post is pressed. Same shape as
// the scope screen's AddEvidence - upload as you go, so nothing is waiting on
// Send and nothing is lost if the page reloads mid-thought.
//
// A recording alone is a valid note (migration 037), so the button is live as
// soon as there is either text or an attachment - not only when there is text.
export function NoteBox({ projectId }: { projectId: string | null }) {
  const [files, setFiles] = useState<Attached[]>([]);
  const [text, setText] = useState("");
  const ready = text.trim().length > 0 || files.length > 0;

  return (
    <>
      <textarea name="note" rows={4} className="input" value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What happened, what is next, what is blocked…" />
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />

      {/* No project, no evidence: record_project_file files against one, and
          a task without a project is a portal oddity, not a site note. */}
      {projectId && <Evidence projectId={projectId} caption="Note evidence" onChange={setFiles} />}

      <button type="submit" name="complete" value="0" className="btn btn-primary btn-block" disabled={!ready}>
        {files.length > 0 && !text.trim() ? "Post the recording" : "Post update"}
      </button>
      <button type="submit" name="complete" value="1" className="btn btn-secondary btn-block">Mark complete</button>
    </>
  );
}
