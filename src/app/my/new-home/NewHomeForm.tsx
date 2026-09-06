"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createHomeStart, addHomeSpaces } from "../actions";
import { setCoverPhoto } from "../project/[id]/actions";

export type RoomType = { code: string; label: string; parent: string | null; wet: boolean; bed: number; bath: number };

// Add a home in one screen: name and address, its photo, and what is in it.
// Three steps under the hood, each needing the last one's id: the project
// is created (small request), the photo goes straight from the browser to
// Storage (never through a server action - Vercel caps those at 4.5 MB),
// and the rooms are written as project_spaces.
export function NewHomeForm({ rooms }: { rooms: RoomType[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  // The room list, grouped for the eye: sleeping, bathing, living, outside.
  const groups = useMemo(() => {
    const isUnder = (r: RoomType, ancestor: string): boolean => {
      let cur: RoomType | undefined = r;
      for (let i = 0; cur && i < 6; i += 1) {
        if (cur.parent === ancestor) return true;
        cur = rooms.find((x) => x.code === cur!.parent);
      }
      return false;
    };
    const beds = rooms.filter((r) => r.bed > 0);
    const baths = rooms.filter((r) => r.bath > 0);
    const outdoor = rooms.filter((r) => isUnder(r, "outdoor") && r.bath === 0);
    const rest = rooms.filter((r) => !beds.includes(r) && !baths.includes(r) && !outdoor.includes(r));
    return [
      { key: "beds", label: "Bedrooms", items: beds },
      { key: "baths", label: "Bathrooms", items: baths },
      { key: "inside", label: "Inside", items: rest },
      { key: "outside", label: "Outside", items: outdoor },
    ];
  }, [rooms]);
  const bump = (code: string, d: number) =>
    setCounts((c) => ({ ...c, [code]: Math.max(0, Math.min(20, (c[code] ?? 0) + d)) }));
  const picked = Object.values(counts).reduce((a, b) => a + b, 0);
  const beds = rooms.filter((r) => r.bed > 0).reduce((a, r) => a + (counts[r.code] ?? 0) * r.bed, 0);
  const baths = rooms.filter((r) => r.bath > 0).reduce((a, r) => a + (counts[r.code] ?? 0) * r.bath, 0);

  function choosePhoto(f: File | null | undefined) {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setPhoto(f);
    setPreview(URL.createObjectURL(f));
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setBusy("Creating the home…");
    try {
      const fd = new FormData();
      fd.set("name", name);
      fd.set("address", address);
      const made = await createHomeStart(fd);
      if (!made.ok) { setErr(made.error); setBusy(""); return; }
      const problems: string[] = [];

      if (photo) {
        setBusy("Uploading the photo…");
        const ext = (photo.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
        const path = `${made.projectId}/cover/cover-${Date.now()}${ext}`;
        const supabase = createClient();
        const { error } = await supabase.storage.from("project-media").upload(path, photo, { contentType: photo.type || undefined, upsert: true });
        if (error) problems.push(`photo: ${error.message}`);
        else {
          const r = await setCoverPhoto(made.projectId, { path, name: photo.name || `cover${ext}`, mime: photo.type, size: photo.size });
          if (!r.ok) problems.push(`photo: ${r.error}`);
        }
      }

      const picks = rooms.filter((r) => (counts[r.code] ?? 0) > 0).map((r) => ({ code: r.code, label: r.label, count: counts[r.code] }));
      if (picks.length > 0) {
        setBusy("Adding the rooms…");
        const r = await addHomeSpaces(made.projectId, picks);
        if (!r.ok) problems.push(`rooms: ${r.error}`);
      }

      // The home exists either way; anything that did not attach is said on
      // its page rather than leaving this form looking stuck.
      const q = problems.length
        ? `?error=${encodeURIComponent(`Home added, but not everything attached — ${problems.join("; ")}`)}`
        : "?saved=1";
      router.push(`/my/project/${made.projectId}${q}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Something went wrong.");
      setBusy("");
    }
  }

  return (
    <form onSubmit={submit} className="card" style={{ display: "grid", gap: 12 }}>
      <p className="muted small" style={{ margin: 0 }}>
        It gets a page of its own — projects, people, paperwork and money.
        To file it under a portfolio later, use <em>Belongs under</em> on its Setup tab.
      </p>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nh-name">What should we call it?</label>
        <input id="nh-name" className="input" required autoComplete="off" placeholder="The Closter house"
          value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <label htmlFor="nh-address">Address</label>
        <input id="nh-address" className="input" required placeholder="12 Maple Ave, Tenafly NJ"
          value={address} onChange={(e) => setAddress(e.target.value)} />
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>Checked against the US Census geocoder on save; a match standardises it, a miss never blocks.</p>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>Photo of the home (optional)</label>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          {preview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" style={{ width: 96, height: 72, objectFit: "cover", borderRadius: 8, border: "1px solid #e7e9e4" }} />
          )}
          <label className="btn ghost small" style={{ cursor: "pointer" }}>
            {photo ? "Change photo" : "Add photo"}
            <input type="file" accept="image/*" hidden onChange={(e) => { choosePhoto(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {photo && <button type="button" className="btn ghost small" onClick={() => { if (preview) URL.revokeObjectURL(preview); setPhoto(null); setPreview(null); }}>Remove</button>}
        </div>
        <p className="muted" style={{ fontSize: 11, margin: "4px 0 0" }}>Shows on your home page. Yours only — not the public showcase picture.</p>
      </div>

      <div className="field" style={{ marginBottom: 0 }}>
        <label>What is in this house? <span className="muted" style={{ fontWeight: 400 }}>· {picked ? `${picked} room${picked === 1 ? "" : "s"} · ${beds} bed · ${baths} bath` : "tap to count rooms"}</span></label>
        <p className="muted" style={{ fontSize: 11, margin: "0 0 6px" }}>Each becomes a space on the home&apos;s page, where its fixtures and finishes are decided later. Nothing else is filled in for you.</p>
        <div style={{ display: "grid", gap: 8 }}>
          {groups.map((g) => g.items.length > 0 && (
            <div key={g.key} style={{ display: "grid", gap: 4 }}>
              <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{g.label}</div>
              <div className="roomgrid">
                {g.items.map((r) => {
                  const n = counts[r.code] ?? 0;
                  return (
                    <div key={r.code} className={`roomrow${n > 0 ? " on" : ""}`}>
                      <button type="button" className="roomname" onClick={() => bump(r.code, n > 0 ? -n : 1)} title={n > 0 ? "Remove" : "Add one"}>
                        {r.label}
                      </button>
                      <span className="roomcount">
                        <button type="button" aria-label={`One fewer ${r.label}`} onClick={() => bump(r.code, -1)} disabled={n === 0}>−</button>
                        <span>{n}</span>
                        <button type="button" aria-label={`One more ${r.label}`} onClick={() => bump(r.code, 1)}>+</button>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
      <div className="btn-row">
        <button className="btn" disabled={!!busy}>{busy || "Add home"}</button>
        <Link className="btn ghost" href="/my">Cancel</Link>
      </div>
    </form>
  );
}
