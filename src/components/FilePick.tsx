"use client";

import { useRef, useState } from "react";

// A file input dressed as a button, with the chosen file names listed
// under it. `capture` opens the camera directly on phones.
export function FilePick({
  name,
  label,
  accept,
  capture,
  multiple = true,
}: {
  name: string;
  label: string;
  accept: string;
  capture?: "environment" | "user";
  multiple?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<string[]>([]);

  return (
    <div style={{ display: "grid", gap: 4, justifyItems: "start" }}>
      <button type="button" className="btn ghost" onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        name={name}
        accept={accept}
        capture={capture}
        multiple={multiple}
        hidden
        onChange={(e) => setNames(Array.from(e.target.files ?? []).map((f) => f.name))}
      />
      {names.map((n) => (
        <span key={n} className="muted small" style={{ wordBreak: "break-all" }}>📎 {n}</span>
      ))}
    </div>
  );
}
