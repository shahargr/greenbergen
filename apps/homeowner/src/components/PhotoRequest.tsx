"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { friendly } from "@shared/rpc";
import { Notice } from "@shared/ui";

// The photos, asked for AFTER the job is booked. Nobody is held at the door
// for them: the price is already locked, this is what lets the contractor
// confirm it without driving over. One slot per photo the package wants,
// each uploading on its own the moment it is picked - so a person on a bus
// can add one now and the rest tonight, and nothing is lost either way.
// homeowner_photo_add records the file against the slot and closes the
// request task when the last one lands.
export type Slot = { key: string; label: string; hint: string | null; file_id: string | null };
type State = { state: "ready" | "uploading" | "done" | "failed"; preview?: string; error?: string };

export function PhotoRequest({ projectId, slots, compact = false }: { projectId: string; slots: Slot[]; compact?: boolean }) {
  const router = useRouter();
  const [have, setHave] = useState<Record<string, State>>(() =>
    Object.fromEntries(slots.filter((s) => s.file_id).map((s) => [s.key, { state: "done" } as State])));
  const [err, setErr] = useState("");
  const left = slots.filter((s) => have[s.key]?.state !== "done" && have[s.key]?.state !== "uploading").length;

  useEffect(() => () => { for (const v of Object.values(have)) if (v.preview) URL.revokeObjectURL(v.preview); }, [have]);

  async function upload(slot: Slot, file: File | null | undefined) {
    if (!file) return;
    setErr("");
    const preview = URL.createObjectURL(file);
    setHave((h) => ({ ...h, [slot.key]: { state: "uploading", preview } }));
    const supabase = createClient();
    const { path, ext } = storagePath(projectId, slot.key, file.name);
    const { error: upErr } = await supabase.storage.from("project-media").upload(path, file, { contentType: file.type || undefined });
    if (upErr) {
      setHave((h) => ({ ...h, [slot.key]: { state: "failed", preview, error: upErr.message } }));
      setErr(`${slot.label} didn't upload: ${upErr.message}. The photo is still on your phone — try again.`);
      return;
    }
    const { data, error } = await supabase.rpc("homeowner_photo_add", {
      p_project: projectId, p_path: path, p_key: slot.key,
      p_file_name: file.name || `${slot.key}${ext}`, p_mime: file.type || "image/jpeg", p_size: file.size,
    });
    if (error || !data?.ok) {
      setHave((h) => ({ ...h, [slot.key]: { state: "failed", preview, error: friendly(data?.reason ?? error?.message) } }));
      setErr(friendly(data?.reason ?? error?.message));
      return;
    }
    setHave((h) => ({ ...h, [slot.key]: { state: "done", preview } }));
    // The last one closes the request; the page above it says so.
    if ((data.photos?.outstanding ?? 1) <= 0) router.refresh();
  }

  if (slots.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {slots.map((s, i) => <PhotoRow key={s.key} index={i + 1} slot={s} st={have[s.key]} compact={compact} onPick={(f) => void upload(s, f)} />)}
      {err && <Notice kind="error">{err}</Notice>}
      {left === 0 && <div className="banner-ok">That&apos;s all of them. Your contractor can confirm the price from these.</div>}
    </div>
  );
}

function PhotoRow({ index, slot, st, compact, onPick }: { index: number; slot: Slot; st?: State; compact: boolean; onPick: (f: File | null | undefined) => void }) {
  const cam = useRef<HTMLInputElement>(null);
  const lib = useRef<HTMLInputElement>(null);
  const done = st?.state === "done";
  return (
    <div className={`slot ${st?.state === "failed" ? "failed" : ""}`}>
      <div className="head">
        <div className="n">{index} · {slot.label}</div>
        {done && <button type="button" className="btn btn-ghost" onClick={() => cam.current?.click()}>Replace</button>}
      </div>
      {st?.preview && !compact && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="thumb" src={st.preview} alt={slot.label} />
      )}
      {st?.state === "uploading" && <div className="small text-muted">Uploading…</div>}
      {st?.state === "failed" && <div className="small" style={{ color: "var(--color-danger)" }}>{st.error ?? "That didn't go through"} — the photo is still on your phone.</div>}
      {done && <div className="small text-muted">In your job folder ✓</div>}
      {!done && st?.state !== "uploading" && (
        <>
          {slot.hint && <div className="small text-muted">{slot.hint}</div>}
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => cam.current?.click()}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></svg>
              Camera
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => lib.current?.click()}>Library</button>
          </div>
        </>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={lib} type="file" accept="image/*" hidden onChange={(e) => { onPick(e.target.files?.[0]); e.target.value = ""; }} />
    </div>
  );
}

// Module-level so the render-purity lint leaves the clock alone.
const storagePath = (projectId: string, key: string, fileName: string) => {
  const ext = (fileName.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
  return { path: `${projectId}/photos/${Date.now()}-${key}${ext}`, ext };
};
