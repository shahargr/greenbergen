"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@shared/supabase/client";
import { JoinForm } from "@/app/join/JoinForm";
import { friendly, isMissingFunction } from "@shared/rpc";
import { Notice } from "@shared/ui";

// What replaces "book it" when nobody approved can do the job.
//
// The tile already says "no contractor yet"; this is the one thing a member
// can do about it. It has to WRITE something or it is a lie, so it creates a
// task in the unified list (homeowner_notify_when_covered) - which doubles as
// the demand signal for deciding which trade to go recruit next.
//
// Asking twice is not an error and is not two rows: the function dedupes and
// says so, and the button just settles into the same "we have it" state.
export function NotifyMe({ code, trade, signedIn }: { code: string; trade: string | null; signedIn: boolean }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const router = useRouter();

  const who = trade ? trade.toLowerCase() : "someone";

  // The same account step every book-now flow has (Shahar): in place, new
  // member or returning, and the button appears once the session exists.
  if (!signedIn) {
    return (
      <JoinForm refId={null} prefillName="" next={`/packages/${code}`}
        embed={{ title: "Tell us who to call when this opens.", lead: `Your account in a few fields; you hear from us the day a ${who} contractor is approved. Nothing is charged or committed.`, onDone: () => router.refresh() }} />
    );
  }

  if (done) {
    return (
      <div className="banner-ok" style={{ margin: 0 }}>
        Noted. You&apos;ll hear from us the day a {who} contractor is approved — and nothing is
        charged or committed meanwhile.
      </div>
    );
  }

  async function ask() {
    setBusy(true); setErr("");
    const supabase = createClient();
    const { data, error } = await supabase.rpc("homeowner_notify_when_covered", { p_code: code });
    setBusy(false);
    if (error) { setErr(isMissingFunction(error) ? "This part isn't switched on yet — text us instead." : friendly(error.message)); return; }
    if (!data?.ok) { setErr(friendly(data?.reason)); return; }
    setDone(true);
  }

  return (
    <>
      <button type="button" onClick={ask} disabled={busy} className={`btn btn-secondary btn-block ${busy ? "busy" : ""}`}>
        {busy ? <><span className="spin" /> Noting it…</> : "Tell me when someone covers this"}
      </button>
      {err && <Notice kind="error">{err}</Notice>}
    </>
  );
}
