"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createClient } from "@shared/supabase/client";

// THE EXPLAINER, IN THE SECOND HALF OF THE SCREEN (Shahar). A package can
// carry several versions of it (Admin > Packages > The explainer video);
// this picks ONE per viewer and reports what happened, so Admin can read
// which version earns the play, the finish and the booking.
//
// SAME PERSON, SAME VERSION. The browser keeps a viewer key; the version is
// that key hashed across the active list. A viewer who reloads sees the
// same video, which is what makes the numbers mean something.
//
// PLAY IS A TAP. A poster with a play button stands in until the viewer
// taps it; only then does the YouTube frame (autoplaying) or the file load.
// That is the play event without a player API, and it keeps the page light
// for the many who scroll past.
//
// Events are sent only for signed-in members: the anon catalogue surface
// stays read-only (rulebook 71). A visitor still sees the video.
export type PackageVideoRow = { id: string; label: string; url: string };

const KEY = "gb_viewer";

// The viewer key is browser state read through useSyncExternalStore: null
// on the server, the stored (or freshly made) key on the client, with no
// state set from an effect. localStorage may be unavailable; then the
// key is "anon" and the first version is shown.
let memo: string | null = null;
function readViewerKey(): string {
  if (memo) return memo;
  try {
    const have = localStorage.getItem(KEY);
    if (have) { memo = have; return have; }
    const made = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).slice(0, 36);
    localStorage.setItem(KEY, made);
    memo = made;
    return made;
  } catch {
    memo = "anon";
    return memo;
  }
}
const noop = () => () => {};

function pick(key: string, n: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h % n;
}

const youtubeId = (url: string) => url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/)?.[1] ?? null;

// poster: the package photograph, when there is one - the still a visitor
// sees before the tap, in place of YouTube's own thumbnail.
export function PackageVideo({ videos, signedIn, title, poster: posterProp = null }: { videos: PackageVideoRow[]; signedIn: boolean; title: string; poster?: string | null }) {
  const key = useSyncExternalStore(noop, readViewerKey, () => null);
  const [playing, setPlaying] = useState(false);
  const sent = useRef<Set<string>>(new Set());

  const video = useMemo(() => (key && videos.length ? videos[pick(key, videos.length)]! : null), [key, videos]);
  const videoId = video?.id ?? null;

  // One 'shown' per mount, once the version is known.
  useEffect(() => {
    if (!signedIn || !videoId || !key || sent.current.has("shown")) return;
    sent.current.add("shown");
    void createClient().rpc("homeowner_video_event", { p_video: videoId, p_event: "shown", p_viewer: key });
  }, [signedIn, videoId, key]);

  function send(event: "play" | "complete") {
    if (!signedIn || !videoId || !key || sent.current.has(event)) return;
    sent.current.add(event);
    void createClient().rpc("homeowner_video_event", { p_video: videoId, p_event: event, p_viewer: key });
  }

  if (!video) return null;
  const yt = youtubeId(video.url);
  const poster = posterProp ?? (yt ? `https://img.youtube.com/vi/${yt}/hqdefault.jpg` : null);

  return (
    <div className="video-box">
      {!playing ? (
        <button type="button" className="video-poster" onClick={() => { setPlaying(true); send("play"); }} aria-label={`Play: ${title}`}>
          {poster
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={poster} alt="" />
            : <span className="video-blank" aria-hidden />}
          <span className="video-play" aria-hidden>
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
          <span className="video-cap">How it works</span>
        </button>
      ) : yt ? (
        <div className="video-frame">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&modestbranding=1&playsinline=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <video controls autoPlay playsInline preload="metadata" src={video.url} style={{ width: "100%", borderRadius: 14, display: "block" }}
          onEnded={() => send("complete")} />
      )}
    </div>
  );
}
