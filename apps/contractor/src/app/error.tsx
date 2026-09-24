"use client";

// THE FRIENDLY CRASH SCREEN (2026-09-24). Shahar kept hitting the browser's
// black "This page couldn't load" after deploys: a tab holding the OLD build
// clicks a button whose server action no longer exists on the server, the
// request fails, and the browser has nothing to say about it. This boundary
// catches that (and any other client crash) and says the one thing that
// almost always fixes it: reload.
export default function AppError({ error, reset }: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="body" style={{ display: "grid", gap: 10, padding: "32px 20px", maxWidth: 420, margin: "0 auto" }}>
      <strong style={{ fontSize: 16 }}>That didn&apos;t go through.</strong>
      <p className="small text-muted" style={{ margin: 0 }}>
        Most of the time this means the app was updated while this page was open,
        so the button you tapped pointed at code that no longer exists. Reloading
        picks up the new version and your data is untouched.
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
        <button type="button" className="btn btn-ghost" onClick={reset}>Try again</button>
      </div>
      {error?.digest && <p className="tiny text-muted" style={{ margin: 0 }}>Ref {error.digest}</p>}
    </div>
  );
}
