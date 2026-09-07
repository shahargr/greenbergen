"use client";

import { useEffect, useState } from "react";

// E3 - offline / degraded: an inline banner, content stays readable.
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const sync = () => setOffline(typeof navigator !== "undefined" && !navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);
  if (!offline) return null;
  return (
    <div className="notice offline" role="status" style={{ width: "100%", maxWidth: 430, position: "sticky", top: 0, zIndex: 40 }}>
      You&apos;re offline. Showing what we have — anything you send goes out when you&apos;re back.
    </div>
  );
}
