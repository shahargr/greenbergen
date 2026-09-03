import Link from "next/link";
import { FileDrop } from "@/components/FileDrop";
import { configAttach, configToggle } from "./actions";

export type ConfigItem = {
  id: string;
  label: string;
  requiresPhoto: boolean;
  done: boolean;
  photos: string[]; // signed thumbnail urls
};

// The configuration checklist, styled as part of the Configuration card:
// one connected list, a green check when done, and photo items carry an
// inline attach button (with any attached thumbnails right there).
export function ConfigChecklist({ projectId, items }: { projectId: string; items: ConfigItem[] }) {
  return (
    <div style={{ display: "grid", gap: 0, border: "1px solid var(--line, #e5e7eb)", borderRadius: 10, overflow: "hidden" }}>
      {items.map((it, i) => (
        <div key={it.id}
          style={{
            display: "grid", gap: 6, padding: "10px 12px",
            borderTop: i === 0 ? "none" : "1px solid var(--line, #e5e7eb)",
            background: it.done ? "#f2f7f3" : "#fff",
          }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <form action={configToggle.bind(null, projectId, it.id, !it.done)} style={{ display: "flex" }}>
              <button type="submit" title={it.done ? "Mark not done" : "Mark done"}
                style={{ border: 0, background: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>
                {it.done ? "✅" : "⬜"}
              </button>
            </form>
            <span style={{ flex: 1, minWidth: 0 }}>
              <strong style={{ fontSize: 13.5, fontWeight: 600 }}>{it.label.replace(/^Config: /, "")}</strong>
              {it.requiresPhoto && !it.done && it.photos.length === 0 && (
                <span className="muted small"> · photo needed</span>
              )}
            </span>
            <Link href={`/my/task/${it.id}`} className="muted small" style={{ whiteSpace: "nowrap" }}>Details →</Link>
          </div>

          {(it.requiresPhoto || it.photos.length > 0) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", paddingLeft: 28 }}>
              {it.photos.map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="" style={{ width: 46, height: 46, objectFit: "cover", borderRadius: 6, display: "block" }} />
                </a>
              ))}
              <form action={configAttach.bind(null, projectId, it.id)}>
                <FileDrop name="photos" accept="image/*" label="Add photos" />
                <button type="submit" className="btn ghost small" style={{ marginTop: 6 }}>Attach &amp; done</button>
              </form>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
