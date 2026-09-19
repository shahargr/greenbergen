"use client";

import { useEffect } from "react";

// THE HOP, MADE VISIBLE.
//
// /after-login used to be a route handler: two HTTP redirects with no UI
// between the sign-in screen and the door. The email-code path was covered by
// the sign-in button, which never resets `busy` on success and keeps spinning
// while the browser leaves - but Google and the magic link come back from
// somewhere else entirely, so there was nothing on the glass at all.
//
// A page can paint. This one renders the loading screen immediately, resolves
// the destination in a Suspense boundary behind it, and only then leaves -
// and because location.replace keeps the current document up until the next
// one answers, the loading screen stays on the glass across the hop into the
// other app too. That last part is why this is not a server redirect: a
// redirect has no document to leave showing.
//
// replace, not assign: the back button should return to wherever they came
// from, never into a sign-in hand-off that would just bounce them forward.
export function GoTo({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  // WITHOUT JAVASCRIPT this was a 307 and still worked, so it still has to.
  // The meta refresh does the hop; the link is there in case a browser
  // ignores it, and it is the only thing here a person would ever click.
  return (
    <noscript>
      <meta httpEquiv="refresh" content={`0;url=${href}`} />
      <p style={{ textAlign: "center", padding: "1rem" }}>
        <a href={href}>Continue</a>
      </p>
    </noscript>
  );
}
