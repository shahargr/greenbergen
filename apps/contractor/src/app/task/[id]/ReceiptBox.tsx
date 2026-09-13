"use client";

import { useState } from "react";
import { Evidence, type Attached } from "@shared/Evidence";

export type ReceiptFile = {
  file_id: string; name: string | null; kind: string | null; bucket: string; path: string;
};

// THE RECEIPTS ON ONE PAYMENT.
//
// Shahar (2026-09-13): "when logging a payment. i need a way to edit it and
// add photos into it. right now i cannot."
//
// He could not, and it was worse than a missing button. file_links - the
// table that says what a file is ABOUT - had a column for every target there
// is except a transaction, so task_payment_log filed the receipt against the
// TASK. It set action_id and project_id together, which is two targets, and
// chk_file_links_one_target allows exactly one: every attempt to attach a
// receipt while logging a payment raised a constraint violation and took the
// whole payment down with it. Zero rows in file_links carry both, which is
// the proof it never once worked (migration 084).
//
// So this is the other half. A receipt now belongs to the payment it paid -
// which also means three payments on one task no longer share one
// undifferentiated pile of paper - and it can be added to, or taken off,
// after the fact.
//
// Taking one off UNLINKS it. The file stays in the project's folder, because
// somebody uploaded a real document and removing it from a row is not a
// reason to destroy it.
export function ReceiptBox({ projectId, existing, urls }: {
  projectId: string | null;
  existing: ReceiptFile[];
  urls: Record<string, string>;
}) {
  const [added, setAdded] = useState<Attached[]>([]);
  const [drop, setDrop] = useState<string[]>([]);
  const toggle = (id: string) =>
    setDrop((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <div className="field">
      <span className="field-label">
        Receipt{existing.length === 1 ? "" : "s"}
        {existing.length > 0 ? ` · ${existing.length}` : <span className="text-muted"> (none on file)</span>}
      </span>

      <input type="hidden" name="add_file_ids" value={added.map((f) => f.id).join(",")} />
      <input type="hidden" name="remove_file_ids" value={drop.join(",")} />

      {existing.length > 0 && (
        <div className="stack" style={{ gap: 8, marginBottom: 10 }}>
          {existing.map((f) => {
            const url = urls[f.path];
            const gone = drop.includes(f.file_id);
            return (
              <div key={f.file_id} className="stack" style={{ gap: 6, opacity: gone ? 0.4 : 1 }}>
                {f.kind === "photo" && url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={url} alt={f.name ?? "Receipt"}
                    style={{ width: "100%", borderRadius: 10, display: "block",
                      filter: gone ? "grayscale(1)" : undefined }} />
                )}
                {f.kind === "audio" && url && <audio src={url} controls preload="none" style={{ width: "100%" }} />}
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <span className="tiny grow" style={{ minWidth: 0, textDecoration: gone ? "line-through" : undefined }}>
                    {url && f.kind !== "photo" && f.kind !== "audio"
                      ? <a href={url} target="_blank" rel="noreferrer">{f.name ?? f.kind ?? "Receipt"}</a>
                      : (f.name ?? f.kind ?? "Receipt")}
                  </span>
                  <button type="button" className="btn btn-ghost small" onClick={() => toggle(f.file_id)}>
                    {gone ? "Keep it" : "Take it off"}
                  </button>
                </div>
              </div>
            );
          })}
          {drop.length > 0 && (
            <p className="tiny text-muted" style={{ margin: 0 }}>
              {drop.length === 1 ? "That one comes" : `Those ${drop.length} come`} off this payment when you save.
              The file stays in the project&apos;s folder.
            </p>
          )}
        </div>
      )}

      {/* record_project_file files against a project, so a payment with no
          project has nowhere to put one - a portal oddity, not a site cost. */}
      {projectId && (
        <Evidence projectId={projectId} caption="Add a receipt" folder="receipts"
          accept="image/*,application/pdf" onChange={setAdded} />
      )}
    </div>
  );
}
