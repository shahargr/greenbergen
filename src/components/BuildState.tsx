"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// IS THIS SCREEN THE LATEST CODE? (portal copy)
//
// The twin of apps/shared/src/BuildState.tsx, and deliberately a COPY rather
// than an import. The portal is its own Vercel project with Root Directory
// "/" and declares no dependency on the shared workspace; reaching across
// that line is the exact shape of the bug BUILD.md section 15 records -
// Vercel builds its dependency graph from the package.json files, so a
// portal that imported apps/shared without declaring it would stop
// rebuilding when the shared file changed. Change one, change the other.
//
//
// Shahar (2026-09-17), after a push produced no Vercel deployment at all:
// "Possible to add to every screen if vercel code is the latest by comparing
// versions running to the last one available on git?"
//
// It is, and it needs nothing stored. Vercel bakes the commit it built into
// the deployment as VERCEL_GIT_COMMIT_SHA; the layout reads that env var on
// the server and hands it down as a prop. GitHub answers the other half:
// /compare/<running>...main says "identical" or how far ahead main is, and
// carries the newest commit's message with it. The repo is public, so the
// call needs no token and no secret is involved.
//
// WHY THE BROWSER MAKES THE CALL. Doing this on the server would mean
// reading cookies inside the layout, which drags every static page in all
// three apps into dynamic rendering - and a build that happens to be behind
// main (exactly the case this exists for) could then fail to prerender. The
// env read is the only server half, and an env read is free and static-safe.
//
// WHAT IT COSTS EVERYONE ELSE. Nothing. No auth cookie, no request at all,
// so a visitor reading the marketing pages never touches this. A signed-in
// user costs one is-this-you call, cached for the session; anybody who is
// not the operator is then finished for good. A homeowner cannot make a
// deployment happen, so telling them their page is three commits old is
// noise about our plumbing on their screen.
const REPO = "shahargr/greenbergen";
const BRANCH = "main";
const ADMIN_KEY = "gb_build_admin";
const SEEN_KEY = "gb_build_seen";
const FRESH_MS = 5 * 60 * 1000;
const short = (sha: string) => sha.slice(0, 7);

type Seen = { at: number; sha: string; behind: number; head: string; title: string | null; when: string | null };

function ago(iso: string | null): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return null;
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const read = <T,>(key: string): T | null => {
  try { const raw = sessionStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
};
const write = (key: string, value: unknown) => {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
};

export function BuildState({ running }: { running?: string }) {
  const [seen, setSeen] = useState<Seen | null>(null);

  useEffect(() => {
    if (!running) return;                                   // local dev, or a build not made from git
    if (!document.cookie.includes("-auth-token")) return;   // nobody is signed in: never ask anything

    let alive = true;
    const go = async () => {
      // Cached answer for this deployment, five minutes old at most.
      const cached = read<Seen>(SEEN_KEY);
      if (cached && cached.sha === running && Date.now() - cached.at < FRESH_MS) {
        if (alive) setSeen(cached);
        return;
      }

      // Is this the operator? Asked once per session, and a "no" is final -
      // the answer cannot change under a signed-in user.
      const admin = read<boolean>(ADMIN_KEY);
      if (admin === false) return;
      if (admin !== true) {
        const { data, error } = await createClient().rpc("real_is_superadmin");
        if (error) return;                                  // never nag on a failure
        write(ADMIN_KEY, data === true);
        if (data !== true) return;
      }

      try {
        const r = await fetch(`https://api.github.com/repos/${REPO}/compare/${running}...${BRANCH}`, {
          headers: { accept: "application/vnd.github+json" },
        });
        if (!r.ok) return;                                  // rate limited, offline, GitHub having a day
        const cmp = await r.json() as {
          status?: string; ahead_by?: number;
          commits?: { sha: string; commit?: { message?: string; author?: { date?: string } } }[];
        };
        const behind = cmp.ahead_by ?? 0;
        const newest = cmp.commits?.[cmp.commits.length - 1];
        const next: Seen = {
          at: Date.now(), sha: running, behind,
          head: newest?.sha ?? running,
          title: cmp.status === "identical" ? null : newest?.commit?.message?.split("\n")[0] ?? null,
          when: cmp.status === "identical" ? null : newest?.commit?.author?.date ?? null,
        };
        write(SEEN_KEY, next);
        if (alive) setSeen(next);
      } catch {
        // A build badge never breaks a screen. Silence is the right failure.
      }
    };
    void go();
    return () => { alive = false; };
  }, [running]);

  if (!running || !seen || seen.behind <= 0) return null;

  return (
    <details className="bld">
      <summary className="bld-pill" title={`Running ${short(running)}; ${BRANCH} is ${seen.behind} ahead`}>
        <span className="dot" aria-hidden />
        <span>{seen.behind} behind</span>
      </summary>
      <div className="bld-card">
        <div className="t">This screen is running older code</div>
        <div className="m">
          Running <code>{short(running)}</code> · {BRANCH} is at <code>{short(seen.head)}</code>
        </div>
        {seen.title && <div className="m">Newest: {seen.title}</div>}
        {ago(seen.when) && <div className="m">Pushed {ago(seen.when)}</div>}
        <div className="m dim">
          It goes live when Vercel builds it. Nothing to press — a manual trigger creates a
          deployment too, which is the thing being refused when the day&apos;s budget is spent.
        </div>
      </div>
    </details>
  );
}
