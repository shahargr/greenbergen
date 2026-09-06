"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setHomeWorkstream } from "./actions";

// The standing workstreams every home starts with (blueprint_home_projects),
// each with the owner's switch. Off hides the project from the lists and
// keeps everything in it; on brings it back, or opens it if this home never
// had it. Only the owner sees this panel (the page gates on rank 70).
export type Workstream = {
  code: string;
  name: string;
  description: string | null;
  is_active: boolean;
  project_id: string | null;
  enabled: boolean;
  disabled_at: string | null;
  open_tasks: number;
};

export function HomeWorkstreams({ homeId, items }: { homeId: string; items: Workstream[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busyCode, setBusyCode] = useState<string | null>(null);
  const [err, setErr] = useState("");

  function flip(w: Workstream) {
    setErr("");
    setBusyCode(w.code);
    start(async () => {
      const r = await setHomeWorkstream(homeId, w.code, !w.enabled);
      if (!r.ok) setErr(r.error);
      setBusyCode(null);
      router.refresh();
    });
  }

  if (items.length === 0) return null;
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <h2 className="section-title" style={{ margin: 0 }}>Standing workstreams</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Every home starts with these. Switch one off to take it off your lists — its tasks, files and
        payments stay put, and you can switch it back on any time.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        {items.map((w) => {
          const busy = pending && busyCode === w.code;
          return (
            <div key={w.code} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "6px 0", borderTop: "1px solid #eef0ea" }}>
              <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                {w.project_id && w.enabled
                  ? <Link href={`/my/project/${w.project_id}`} style={{ fontWeight: 700 }}>{w.name}</Link>
                  : <strong style={{ color: w.enabled ? undefined : "#8a8f86" }}>{w.name}</strong>}
                <div className="muted" style={{ fontSize: 12 }}>
                  {w.enabled
                    ? <>{w.open_tasks} open task{w.open_tasks === 1 ? "" : "s"}</>
                    : w.project_id ? <>Off{w.open_tasks > 0 ? ` · ${w.open_tasks} open task${w.open_tasks === 1 ? "" : "s"} kept` : ""}</> : <>Not on this home yet</>}
                </div>
              </div>
              <button
                type="button"
                className={w.enabled ? "btn ghost small" : "btn small"}
                disabled={busy}
                aria-pressed={w.enabled}
                onClick={() => flip(w)}
              >
                {busy ? "…" : w.enabled ? "Switch off" : "Switch on"}
              </button>
            </div>
          );
        })}
      </div>
      {err && <p className="error small" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
