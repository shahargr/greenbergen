"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

// UPLOAD AS MANY AS YOU NEED, FILE THEM WHERE THEY BELONG (migration 186).
//
// Shahar (2026-09-17): "in the bid room, the user can upload as many documents
// as needed, and attach them as needed to the bid, and or to the awarded deal.
// this way, all necessary documents are stored in one place."
//
// Evidence does the upload and hands ids up; this only decides where they get
// filed - the room (what everybody prices from) or one bidder's own bid (the
// proposal that came back from him). The database checks the file belongs to
// the project before it links anything.
export function BidPapers({ projectId, bidId, label, action }: {
  projectId: string;
  /** Set when these papers belong to one bidder rather than to the room. */
  bidId?: string;
  label: string;
  action: (formData: FormData) => void;
}) {
  const [files, setFiles] = useState<Attached[]>([]);

  return (
    <form action={action} className="stack" style={{ gap: 8 }}>
      <input type="hidden" name="file_ids" value={files.map((f) => f.id).join(",")} />
      {bidId && <input type="hidden" name="bid_id" value={bidId} />}
      <Evidence projectId={projectId} caption={label} folder="bids" onChange={setFiles}
        accept="application/pdf,image/*,.doc,.docx,.xls,.xlsx" />
      <button className="btn btn-secondary btn-block" disabled={files.length === 0}>
        {files.length === 0 ? "Add the papers first"
          : `File ${files.length} ${files.length === 1 ? "document" : "documents"}${bidId ? " against his bid" : " on the room"}`}
      </button>
    </form>
  );
}
