"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

// The update box, with proof.
//
// It sits inside the task's ONE form and does the job the form cannot: it
// holds the ids of files uploaded WHILE the note was being written, and hands
// them over in a hidden field when the form is saved. Upload as you go, so
// nothing is waiting on Save and nothing is lost if the page reloads
// mid-thought.
//
// The buttons used to live here, which is how the screen ended up with three
// saves and Shahar lost a drawer full of edits to the wrong one (2026-09-12).
// There is one Save now and it belongs to the form, not to this box.
export function NoteBox({ projectId }: { projectId: string | null }) {
  const [files, setFiles] = useState<Attached[]>([]);
  const [text, setText] = useState("");

  return (
    <>
      <textarea name="note" rows={4} className="input" value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What happened, what is next, what is blocked…" />
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />

      {/* No project, no evidence: record_project_file files against one, and
          a task without a project is a portal oddity, not a site note. */}
      {projectId && <Evidence projectId={projectId} caption="Note evidence" onChange={setFiles} />}
    </>
  );
}
