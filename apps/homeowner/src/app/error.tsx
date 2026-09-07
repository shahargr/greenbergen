"use client";

import { useEffect } from "react";
import { AppBar, Blueprint, Screen } from "@shared/ui";

// E2 - full-screen failure to load. Our side, not theirs; a reference so a
// person can find it in the logs.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const ref = `GB-${(error.digest ?? "0000").slice(0, 4).toUpperCase()}`;
  const when = new Date().toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <Blueprint pad>
          <h1>This didn&apos;t load.</h1>
          <p className="lead text-muted">Our side, not yours. Your project and photos are safe. Try again in a moment — if it keeps happening, text us and a person answers.</p>
          <p className="tiny text-muted" style={{ margin: 0 }}>Error ref {ref} · {when}</p>
        </Blueprint>
      </div>
      <div className="actions">
        <button className="btn btn-primary btn-block blueprint" onClick={reset}>Try again</button>
        <a className="btn btn-ghost btn-block" href="sms:+12015550100?body=Hi%20Green%20Bergen%2C%20the%20app%20showed%20me%20an%20error">Text Green Bergen</a>
      </div>
    </Screen>
  );
}
