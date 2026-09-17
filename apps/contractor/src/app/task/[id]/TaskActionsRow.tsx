"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useFormDirty } from "./TaskBar";

// WHO HOLDS IT, WHAT IT COST, WHAT COMES UNDER IT - ONE ROW.
//
// Shahar (2026-09-17): "below, in one row, place both assigned to, log
// payment, and add steps under this task. add steps under this task be
// disabled until the task is saved. show it on the button."
//
// Three things that used to be in three places - the assignee a row on its
// own, the payment a drawer at the foot of the form, the step a full-width
// button above the form - and none of them wide. The payment drawer opens
// right under the row when its button is pressed (Shahar chose "open it
// here" over leaving for the money screen), so logging what you paid does
// not mean scrolling to the bottom to find where the box went.
//
// THE STEP BUTTON GOES QUIET WHILE THERE ARE UNSAVED EDITS. Opening the
// new-step screen navigates away, and this form does not survive that: what
// was typed would be gone on return. So the button says "Save first" and
// waits, the moment the form differs from how it arrived, and comes back on
// its own once Save has been pressed and the page reloaded clean.
export function TaskActionsRow({
  formId, stepHref, acceptsSteps, canLogPayment, payOpen, payment, children,
}: {
  formId: string;
  /** The new-step screen, already pointed at this task as the parent. Null when steps are off. */
  stepHref: string | null;
  acceptsSteps: boolean;
  canLogPayment: boolean;
  /** The drawer starts open - the action sent us back to a payment that did not save. */
  payOpen: boolean;
  /** The payment box itself; rendered under the row when open. */
  payment: ReactNode;
  /** The Assigned-to control. */
  children: ReactNode;
}) {
  const { dirty } = useFormDirty(formId);
  const [pay, setPay] = useState(payOpen);

  return (
    <>
      <div className="task-row" style={{ gridTemplateColumns: "1fr" }}>
        <div className="task-row-value triple">
          <label className="field">
            <span className="field-label">Assigned to</span>
            {children}
          </label>

          <div className="field">
            <span className="field-label">Payment</span>
            {canLogPayment ? (
              <button type="button" className={`btn ${pay ? "btn-primary" : "btn-secondary"}`}
                style={{ width: "100%", minHeight: 44 }} aria-expanded={pay}
                onClick={() => setPay((o) => !o)}>
                {pay ? "Close payment" : "Log payment"}
              </button>
            ) : (
              <button type="button" className="btn btn-secondary" style={{ width: "100%", minHeight: 44 }} disabled
                title="Payments on this task are not yours to log">
                Log payment
              </button>
            )}
          </div>

          <div className="field">
            <span className="field-label">Steps</span>
            {stepHref && acceptsSteps && !dirty ? (
              <Link href={stepHref} className="btn btn-secondary" style={{ width: "100%", minHeight: 44 }}>
                ＋ Add a step
              </Link>
            ) : (
              <button type="button" className="btn btn-secondary" style={{ width: "100%", minHeight: 44 }} disabled
                title={!acceptsSteps
                  ? "A simple task: one line, no steps under it"
                  : dirty ? "Save this task first - a step opened now would lose what you typed" : "Steps are off on this task"}>
                {!acceptsSteps ? "No steps (simple)" : dirty ? "Save first" : "Add a step"}
              </button>
            )}
          </div>
        </div>
      </div>

      {canLogPayment && pay && (
        <div className="drawer stack" style={{ gap: 10, padding: "12px 0 4px" }}>
          {payment}
        </div>
      )}
    </>
  );
}
