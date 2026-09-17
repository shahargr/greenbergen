"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

// SAVE, UNDO, EXIT - AND A SAVE BUTTON THAT ADMITS WHETHER IT HAS ANYTHING TO DO.
//
// Shahar (2026-09-16): "Keep a top bar with : save, undo, exit. any change made
// in the form should check how save button shows, helping me understand if
// anything requires a save. undo shows only if save was clicked on."
//
// The task screen is long - stage, priority, who holds it, where it stands,
// money, evidence - and the only Save was at the bottom of it. So the two
// questions you actually have while scrolling, "have I changed anything" and
// "how do I get out", both needed a journey to answer.
//
// WHAT DIRTY MEANS HERE. Not "has anything been typed" but "is the form
// different from how it arrived": type a word and delete it again and the
// button goes quiet, because it is telling you about the SAVE, not about your
// keystrokes. Comparing against a snapshot taken on mount is what makes that
// true, and it costs one pass over the fields.
//
// WHAT UNDO MEANS HERE, and what it does not. It is not a revision history -
// the database keeps no before-image of a task and inventing one for a button
// would be a much bigger change than this. It is the narrow, honest thing: the
// values as they were when you opened the screen, put back. That covers the
// case the button exists for - you saved, you immediately wish you had not -
// and nothing else, which is why it only appears on the load that follows a
// save and goes away once used or once you navigate anywhere else.
//
// The note box is deliberately outside all of it: it posts an entry to the
// record rather than editing a field, and "undoing" it would mean retyping
// something that was already published. Notes have their own undo already.
const SKIP = new Set(["do", "note", "back", "id"]);

type Snap = Record<string, string>;

function snapshot(form: HTMLFormElement): Snap {
  const out: Snap = {};
  for (const el of Array.from(form.elements)) {
    const f = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (!f.name || f.type === "file" || f.type === "submit" || f.type === "button") continue;
    out[f.name] = f.type === "checkbox" ? String((f as HTMLInputElement).checked) : f.value;
  }
  return out;
}

function differs(form: HTMLFormElement, was: Snap | null) {
  if (!was) return false;
  const now = snapshot(form);
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if ((was[k] ?? "") !== (now[k] ?? "")) return true;
  }
  return false;
}

// IS THE FORM DIFFERENT FROM HOW IT ARRIVED. One answer, asked by two
// things: the Save button (which lights up) and the Add-a-step button (which
// goes quiet - Shahar, 2026-09-17: "add steps under this task be disabled
// until the task is saved. show it on the button"). A step opened with
// unsaved edits behind it would come back to a form that forgot them.
export function useFormDirty(formId: string) {
  const [dirty, setDirty] = useState(false);
  const was = useRef<Snap | null>(null);
  useEffect(() => {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    was.current = snapshot(form);
    const check = () => setDirty(differs(form, was.current));
    form.addEventListener("input", check);
    form.addEventListener("change", check);
    return () => {
      form.removeEventListener("input", check);
      form.removeEventListener("change", check);
    };
  }, [formId]);
  return { dirty, was };
}

export function TaskBar({ formId, taskId, exitHref, justSaved }: {
  formId: string;
  taskId: string;
  exitHref: string;
  /** The page came back from a save, so an undo has something to undo. */
  justSaved: boolean;
}) {
  const { dirty, was } = useFormDirty(formId);
  const [canUndo, setCanUndo] = useState(false);
  const key = `task-undo:${taskId}`;

  useEffect(() => {
    // An undo offer is only good for the load that follows the save that
    // created it. Arriving any other way clears it, so the button can never
    // sit there offering to restore something from yesterday.
    //
    // Deferred by a tick rather than read here: setting state synchronously in
    // an effect body is a cascading render, and this answer is not needed for
    // the first paint - the bar is correct without the undo button and simply
    // gains it a frame later.
    const t = setTimeout(() => {
      try {
        if (justSaved) setCanUndo(!!sessionStorage.getItem(key));
        else sessionStorage.removeItem(key);
      } catch { /* private window, no storage - the bar works, minus undo */ }
    }, 0);
    return () => clearTimeout(t);
  }, [key, justSaved]);

  // Keep the pre-save values where the next page load can find them. Written
  // on the click rather than on submit so it lands before the navigation.
  function remember() {
    try {
      if (was.current) sessionStorage.setItem(key, JSON.stringify(was.current));
    } catch { /* nothing to do: the save still happens, the undo just will not offer */ }
  }

  function undo() {
    const form = document.getElementById(formId) as HTMLFormElement | null;
    if (!form) return;
    let snap: Snap | null = null;
    try { snap = JSON.parse(sessionStorage.getItem(key) ?? "null"); } catch { snap = null; }
    if (!snap) { setCanUndo(false); return; }
    for (const el of Array.from(form.elements)) {
      const f = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      if (!f.name || SKIP.has(f.name) || f.type === "file") continue;
      const v = snap[f.name];
      if (v === undefined) continue;
      if (f.type === "checkbox") (f as HTMLInputElement).checked = v === "true";
      else f.value = v;
    }
    try { sessionStorage.removeItem(key); } catch { /* already gone */ }
    setCanUndo(false);
    form.requestSubmit();
  }

  return (
    <div className="task-bar">
      <Link href={exitHref} className="tb-btn">Exit</Link>

      {/* UNDO IS NOT ALWAYS THERE, which is the point: a button that is always
          available teaches you nothing, and this one is a statement that a save
          just happened and can still be taken back. */}
      {canUndo && (
        <button type="button" className="tb-btn" onClick={undo}>Undo that save</button>
      )}

      <span className="grow" />

      <span className={`tb-state${dirty ? " on" : ""}`}>
        {dirty ? "Unsaved changes" : "Nothing to save"}
      </span>
      <button type="submit" form={formId} name="do" value="save"
        className={`tb-btn save${dirty ? " on" : ""}`}
        onClick={remember} disabled={!dirty}>
        Save
      </button>
    </div>
  );
}
