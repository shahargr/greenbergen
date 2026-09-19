import { DOORS, DOOR_ORDER, type DoorKey } from "./doors";
import { loadDoors } from "./doors.server";
import { createClient } from "./supabase/server";
import { isSignedIn } from "./supabase/session";
import { DoorIcon } from "./ui";

// THE DOOR SWITCH, FLOATING (Shahar, 2026-09-19).
//
// "for testing, place this icon as a floating icon so i don't need to go back
// all the way every time i need to change the seat i'm logged under."
//
// The same switch already sits in the header - but only on the screens whose
// AppBar was given a switcher, which is the handful of top-level ones. From
// inside a project, a bid room or a trade, changing door means backing out
// three or four screens first, and somebody testing three seats does that
// forty times an evening.
//
// So it floats, on every screen of every app, exactly like the notebook and
// for the same reason: the thing you need is needed wherever you happen to
// be standing. It sits directly above the notebook rather than beside it, so
// the two read as one stack in the corner your thumb already knows.
//
// IT RENDERS NOTHING unless you are signed in AND hold a door other than this
// one. For everybody with a single door - which is nearly everybody - the
// corner is exactly as it was.
// THE COST, because this is in the layout and the layout runs on the public
// pages too. The signed-in check is the cookie verified in process - no round
// trip - and only somebody signed in ever pays for my_doors(), which React
// caches per request and which most signed-in screens have already asked for
// anyway. A visitor to the front door pays nothing.
export async function DoorSwitchFab({ current }: { current: DoorKey }) {
  const supabase = await createClient();
  if (!(await isSignedIn(supabase, "auth.claims.fab"))) return null;

  const doors = await loadDoors();
  if (!doors.signed_in) return null;

  const others = DOOR_ORDER.filter((k) => doors.held.includes(k) && k !== current);
  if (others.length === 0) return null;

  return (
    <details className="door-fab">
      <summary aria-label={`Switch door — you are in ${DOORS[current].label}`}
        title={`You are in ${DOORS[current].label} — switch`}>
        {/* Two arrows passing: the one glyph that reads as "swap" rather than
            as "settings" or "more". The same mark as the header switch, so
            the two are recognisably one control in two places. */}
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
        </svg>
      </summary>
      <div className="door-menu">
        <div className="door-menu-label">You are in {DOORS[current].label}</div>
        {others.map((k) => (
          <a key={k} href={DOORS[k].entry} className="door-menu-row">
            <span className="ic"><DoorIcon door={k} size={18} /></span>
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="t">{DOORS[k].label}</span>
              <span className="m">{DOORS[k].full}</span>
            </span>
          </a>
        ))}
      </div>
    </details>
  );
}
