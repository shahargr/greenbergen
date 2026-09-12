"use client";

import { useState } from "react";
import { createClient } from "./supabase/client";
import { friendly } from "./rpc";
import { DOORS, DOOR_ORDER, type DoorKey } from "./doors";

// WHERE YOU LAND WHEN YOU SIGN IN.
//
// Shahar (2026-09-12): "home owner and pro : default professional - able to
// update the default in settings, and able to switch between using that mask
// from the previous version in the top nav bar."
//
// Only shown to somebody who holds more than one door - for everybody else
// there is nothing to choose and the question would only confuse. "Decide for
// me" is the house rule (Professionals if you have it, else Homeowner), and
// it is the default default: a person who never touches this still lands
// somewhere sensible, and keeps landing somewhere sensible if their doors
// change later.
export function DefaultDoor({ held, current }: { held: DoorKey[]; current: DoorKey | null }) {
  const [door, setDoor] = useState<string>(current ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  if (held.length < 2) return null;

  async function save(next: string) {
    setDoor(next); setBusy(true); setNote("");
    const { data, error } = await createClient().rpc("set_default_door", { p_door: next || null });
    setBusy(false);
    if (error) { setNote(friendly(error.message)); return; }
    if (data?.ok === false) { setNote(data.reason ?? "That did not save."); return; }
    setNote(next ? `Saved. You will land in ${DOORS[next as DoorKey].label} from now on.` : "Saved. We will pick for you.");
  }

  return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span className="field-label">Where you land when you sign in</span>
      <select className="input" value={door} disabled={busy} onChange={(e) => void save(e.target.value)}>
        <option value="">Decide for me</option>
        {DOOR_ORDER.filter((k) => held.includes(k)).map((k) => (
          <option key={k} value={k}>{DOORS[k].label}</option>
        ))}
      </select>
      <span className="hint">
        {note || "You hold more than one door. Switch between them any time from the mark in the top bar."}
      </span>
    </label>
  );
}
