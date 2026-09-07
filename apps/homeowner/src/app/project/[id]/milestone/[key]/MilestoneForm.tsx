"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { dollars } from "@/lib/format";
import { friendly } from "@/lib/rpc";
import { Blueprint, Notice } from "@/components/ui";
import { markMilestone } from "../../actions";

// 15a confirm + pay choice; 15c photograph the check. The photo uploads
// first (browser -> Storage -> record_project_file), then the server action
// marks the milestone and records the payment with the file as evidence.
type How = "card" | "check" | "cash" | "later";

export function MilestoneForm({ projectId, nodeKey, kind, amountCents, totalCents, percent, contractor, alreadyDone }: {
  projectId: string; nodeKey: string; kind: "payment" | "task" | "done"; amountCents: number; totalCents: number; percent: number | null; contractor: string; alreadyDone: boolean;
}) {
  const [how, setHow] = useState<How>("check");
  const [reference, setReference] = useState("");
  const [capture, setCapture] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; preview: string } | null>(null);
  const [fileId, setFileId] = useState<string>("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);

  async function uploadThenSubmit() {
    setErr("");
    if (kind === "payment" && how === "check" && !reference.trim() && !photo) { setErr("A check number or a photo of the check — either is enough."); return; }
    if (photo) {
      setBusy("Saving the photo…");
      const supabase = createClient();
      const ext = (photo.file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
      const path = `${projectId}/payments/${nodeKey}-${photo.file.lastModified}${ext}`;
      const { error: upErr } = await supabase.storage.from("project-media").upload(path, photo.file, { contentType: photo.file.type || undefined, upsert: true });
      if (upErr) { setBusy(""); setErr(`The photo didn't upload (${upErr.message}). The milestone was not marked.`); return; }
      const { data, error } = await supabase.rpc("record_project_file", {
        p_project_id: projectId, p_path: path, p_file_name: photo.file.name, p_mime: photo.file.type || "image/jpeg", p_size: photo.file.size,
        p_caption: how === "cash" ? "Cash receipt" : "Check", p_kind: "photo",
      });
      if (error) { setBusy(""); setErr(friendly(error.message)); return; }
      setFileId(data as string);
      await new Promise((r) => setTimeout(r, 0));
    }
    setBusy("Marking…");
    formRef.current?.requestSubmit();
  }

  if (capture) {
    return (
      <div className="screen dark" style={{ position: "fixed", inset: 0, margin: "0 auto", zIndex: 60 }}>
        <header className="appbar">
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Back" onClick={() => setCapture(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
          </button>
          <div className="title">Photograph the {how === "cash" ? "receipt" : "check"}<span className="sub">Lay it flat. Fit it inside the frame — payee and amount readable.</span></div>
        </header>
        <div className="viewfinder">
          <div className="frame">
            {photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photo.preview} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            ) : "Check goes here"}
            <span className="tag" style={{ position: "absolute", top: 8, left: 8 }}>{how === "cash" ? "Cash receipt from" : "Check to"} {contractor}</span>
            <span className="tag" style={{ position: "absolute", top: 8, right: 8 }}>{dollars(amountCents)} expected</span>
          </div>
          <div className="row" style={{ width: "100%", justifyContent: "space-between", padding: "0 12px" }}>
            <button type="button" className="btn btn-ghost" onClick={() => lib.current?.click()}>Library</button>
            <button type="button" className="shutter" aria-label="Take the photo" onClick={() => cam.current?.click()}><span /></button>
            <button type="button" className="btn btn-ghost" onClick={() => setHow(how === "cash" ? "check" : "cash")}>{how === "cash" ? "It's a check" : "Cash receipt"}</button>
          </div>
          {photo && <button type="button" className="btn btn-primary btn-block blueprint" onClick={() => setCapture(false)}>Use this photo</button>}
        </div>
        <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto({ file: f, preview: URL.createObjectURL(f) }); e.target.value = ""; }} />
        <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) setPhoto({ file: f, preview: URL.createObjectURL(f) }); e.target.value = ""; }} />
      </div>
    );
  }

  return (
    <form ref={formRef} action={markMilestone} className="stack" onSubmit={() => setBusy("Marking…")}>
      <input type="hidden" name="project" value={projectId} />
      <input type="hidden" name="key" value={nodeKey} />
      <input type="hidden" name="how" value={kind === "payment" ? how : "later"} />
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="file_id" value={fileId} />

      {kind === "payment" && (
        <Blueprint pad>
          <div className="kicker">Due at this {nodeKey === "permit_meeting" ? "meeting" : "point"}</div>
          <div className="price" style={{ padding: 0 }}>
            <div className="big mono" style={{ fontSize: 36 }}>{dollars(amountCents)}</div>
            <div className="small text-muted">{percent ? `${percent}% of ${dollars(totalCents)} · ` : ""}paid to <strong>{contractor}</strong>. Green Bergen never holds your money.</div>
          </div>
          <div className="stack" style={{ gap: 8, marginTop: 12 }}>
            <label className="radio choice"><input type="radio" name="how_ui" checked={how === "card"} onChange={() => setHow("card")} /><span className="dot" /><span className="txt">Pay by card now<small>Charged directly by {contractor}&apos;s business — not switched on yet</small></span></label>
            <label className="radio choice"><input type="radio" name="how_ui" checked={how === "check" || how === "cash"} onChange={() => setHow("check")} /><span className="dot" /><span className="txt">I paid by check or cash<small>We&apos;ll ask you to photograph the check or receipt</small></span></label>
            <label className="radio choice"><input type="radio" name="how_ui" checked={how === "later"} onChange={() => setHow("later")} /><span className="dot" /><span className="txt">We met, but haven&apos;t settled up yet<small>We&apos;ll remind you tomorrow</small></span></label>
          </div>
          {(how === "check" || how === "cash") && (
            <div className="stack" style={{ marginTop: 12 }}>
              <div className="seg">
                <label className="seg-opt"><input type="radio" name="kind_ui" checked={how === "check"} onChange={() => setHow("check")} />Check</label>
                <label className="seg-opt"><input type="radio" name="kind_ui" checked={how === "cash"} onChange={() => setHow("cash")} />Cash</label>
              </div>
              {how === "check" && (
                <label className="field"><span className="field-label">Check number</span><input className="input" inputMode="numeric" placeholder="1042" value={reference} onChange={(e) => setReference(e.target.value)} /></label>
              )}
              <div className="row">
                <button type="button" className="btn btn-secondary" onClick={() => setCapture(true)}>{photo ? "Retake the photo" : `Photograph the ${how}`}</button>
                {photo && <span className="small text-muted">Photo attached ✓</span>}
              </div>
            </div>
          )}
          {how === "card" && <Notice>Card payments through the app are coming. For now, pay {contractor} directly — the milestone is still logged when you mark it.</Notice>}
        </Blueprint>
      )}

      {err && <Notice kind="error">{err}</Notice>}
      <div className="actions" style={{ padding: 0 }}>
        <button type="button" className={`btn btn-primary btn-block blueprint ${busy ? "busy" : ""}`} disabled={!!busy || alreadyDone} onClick={() => void uploadThenSubmit()}>
          {busy ? <><span className="spin" /> {busy}</> : kind === "payment" ? (how === "later" ? "Mark done" : how === "card" ? "Mark done" : `Mark done & record ${dollars(amountCents)}`) : kind === "done" ? "Close the job" : "Mark done"}
        </button>
      </div>
    </form>
  );
}
