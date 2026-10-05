"use client";

import type { CSSProperties, ReactNode } from "react";

// A form that asks in words before it submits. "Not interested" is one-way
// for the contractor (only we can undo a decline), and a ghost button at the
// bottom of a screen is exactly the one a thumb lands on by accident.
export function ConfirmForm({ action, message, style, children }: {
  action: () => Promise<void>; message: string; style?: CSSProperties; children: ReactNode;
}) {
  return (
    <form action={action} style={style} onSubmit={(e) => { if (!window.confirm(message)) e.preventDefault(); }}>
      {children}
    </form>
  );
}
