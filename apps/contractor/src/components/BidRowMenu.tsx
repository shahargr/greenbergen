"use client";

import { useEffect, useState } from "react";

// CORRECT THEM, OR TAKE THEM OUT (migration 188). Shahar (2026-09-18): "edit
// the bidding room capability is lacking. edit / remove people for example is
// needed."
//
// Two actions that do not belong in the roster row itself: one is rare and one
// is destructive, and a table row is no place for either standing open. So the
// row carries a "…" and the panel opens under it.
//
// REMOVING SOMEBODY WHO HAS PRICED asks twice, in words rather than a second
// dialog: the database refuses it outright unless the tick is set, because a
// number somebody gave you is evidence, and "close as lost" keeps it while
// this throws it away.
export function BidRowMenu({
  who, person, phone, email, priced, onEdit, onRemove,
}: {
  // The actions arrive already bound to the project, the room and the bid, so
  // this component never needs to know any of the three.
  who: string; person: string | null; phone: string | null; email: string | null;
  priced: boolean;
  onEdit: (formData: FormData) => void;
  onRemove: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState<"" | "edit" | "remove">("");

  // It is a sheet over the page now, not a dropdown inside the table, so it
  // closes the way sheets close: tap outside, or Escape.
  useEffect(() => {
    if (open === "") return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(""); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [open]);

  return (
    <span className="rowmenu">
      <button type="button" className="btn btn-ghost small" aria-expanded={open !== ""}
        aria-label={`Change or remove ${who}`} title="Correct them, or take them out"
        onClick={() => setOpen(open === "" ? "edit" : "")}>…</button>

      {open !== "" && (
        <>
        <button type="button" className="rowmenu-scrim" aria-label="Close"
          onClick={() => setOpen("")} />
        <div className="rowmenu-panel" role="dialog" aria-label={`Change or remove ${who}`}>
          <div className="rowmenu-tabs">
            <button type="button" className={open === "edit" ? "on" : ""} onClick={() => setOpen("edit")}>Correct them</button>
            <button type="button" className={open === "remove" ? "on" : ""} onClick={() => setOpen("remove")}>Take them out</button>
            <button type="button" className="x" onClick={() => setOpen("")} aria-label="Close">✕</button>
          </div>

          {open === "edit" && (
            <form action={onEdit} className="stack" style={{ gap: 8 }}>
              <p className="tiny text-muted" style={{ margin: 0 }}>
                This corrects the address book, not just this room — the number is right everywhere afterwards.
              </p>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Company</span>
                <input className="input" name="company_name" defaultValue={who} />
              </label>
              <label className="field" style={{ marginBottom: 0 }}>
                <span className="field-label">Who you speak to</span>
                <input className="input" name="person_name" defaultValue={person ?? ""} />
              </label>
              <div className="nb-two">
                <label className="nb-fld"><span>Phone</span>
                  <input className="input" name="phone" inputMode="tel" defaultValue={phone ?? ""} /></label>
                <label className="nb-fld"><span>Email</span>
                  <input className="input" name="email" inputMode="email" defaultValue={email ?? ""} /></label>
              </div>
              <button className="btn btn-secondary btn-block">Save the correction</button>
            </form>
          )}

          {open === "remove" && (
            <form action={onRemove} className="stack" style={{ gap: 8 }}>
              <p className="tiny text-muted" style={{ margin: 0 }}>
                {who} comes out of this room. They stay in the address book, and any document filed against their bid
                is unlinked — never deleted.
              </p>
              {priced && (
                <>
                  <p className="tiny" style={{ margin: 0, color: "var(--color-status)" }}>
                    They have already given you a number. Closing them as lost keeps that price on the record; removing
                    them throws it away.
                  </p>
                  <label className="radio-opt" style={{ marginBottom: 0 }}>
                    <input type="checkbox" name="even_if_priced" />
                    <span>Yes — remove them and lose the price</span>
                  </label>
                </>
              )}
              <button className="btn btn-secondary btn-block">Take {who} out</button>
            </form>
          )}
        </div>
        </>
      )}
    </span>
  );
}
