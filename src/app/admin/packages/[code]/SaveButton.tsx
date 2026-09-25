"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

// THE SAVE BUTTON OF ONE SECTION (Shahar: "enable the Save button only once
// a change was made. change save button look after changes were saved").
// Off until something in its form is typed, picked or ticked; "Saving…"
// while the action runs; "✓ Saved" once the page comes back with this
// section's saved flash, until the next edit.
//
// It also owns the Enter key. A browser submits a form on Enter through its
// FIRST submit button, and in a row section that is the first row's ✕ -
// Enter in any field removed a line. Enter now saves, and only when there
// is something to save.
export function SaveButton({ children, saved = false, style }: { children: React.ReactNode; saved?: boolean; style?: React.CSSProperties }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [dirty, setDirty] = useState(false);
  const { pending } = useFormStatus();

  // A save (or a ✕) has finished: the form now holds what the database
  // holds, so there is nothing left to save.
  const [wasPending, setWasPending] = useState(pending);
  if (pending !== wasPending) {
    setWasPending(pending);
    if (!pending) setDirty(false);
  }

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const mark = () => setDirty(true);
    const enter = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement)) return;
      e.preventDefault();
      if (ref.current && !ref.current.disabled) form.requestSubmit(ref.current);
    };
    form.addEventListener("input", mark);
    form.addEventListener("change", mark);
    form.addEventListener("keydown", enter);
    return () => {
      form.removeEventListener("input", mark);
      form.removeEventListener("change", mark);
      form.removeEventListener("keydown", enter);
    };
  }, []);

  const done = saved && !dirty && !pending;
  return (
    <button ref={ref} className={done ? "btn ghost" : "btn"} disabled={!dirty || pending} style={done ? { ...style, opacity: 1 } : style}>
      {pending ? "Saving…" : done ? "✓ Saved" : children}
    </button>
  );
}
