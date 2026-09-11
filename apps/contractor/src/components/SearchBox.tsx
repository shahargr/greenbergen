"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// FIND A TASK FASTER (Shahar, 2026-09-11). One box; what you type becomes
// ?q= on the page you are on, a beat after you stop typing, and the server
// filters the list it already builds - subject, notes, job, trade, who.
// The filters and chips around it are untouched; clearing the box clears
// only the search.
export function SearchBox({ placeholder = "Find a task", count }: { placeholder?: string; count?: number | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function go(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value.trim()) next.set("q", value.trim()); else next.delete("q");
    const s = next.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }
  function onChange(value: string) {
    setQ(value);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(value), 350);
  }

  return (
    <form role="search" onSubmit={(e) => { e.preventDefault(); if (timer.current) clearTimeout(timer.current); go(q); }} className="row" style={{ gap: 6 }}>
      <input className="input" type="search" value={q} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} style={{ minHeight: 44, fontSize: 15 }} />
      {q && (
        <button type="button" className="btn btn-ghost small" onClick={() => { setQ(""); if (timer.current) clearTimeout(timer.current); go(""); }}>Clear</button>
      )}
      {q && count != null && <span className="tiny text-muted" style={{ whiteSpace: "nowrap" }}>{count} found</span>}
    </form>
  );
}

// The test itself lives in @/lib/search - a function exported from THIS file
// is a client export, and the server cannot call one. See the note there.
