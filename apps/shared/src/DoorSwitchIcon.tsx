import { DOORS, DOOR_ORDER, type DoorKey } from "./doors";
import { loadDoors } from "./doors.server";
import { DoorIcon } from "./ui";

// THE DOOR SWITCH, IN THE HEADER.
//
// Shahar (2026-09-14): "add the switch door icon to any logged in user with
// more than one role. it should allow to switch between any role available to
// the user."
//
// It used to live only behind the gear, on the settings screen - three taps
// from wherever you were, which is three taps too many for somebody who holds
// two doors and moves between them all day. The gear keeps its fuller
// switcher (it also offers doors you do NOT hold yet, and sets where you
// land); this is the quick one: the doors that are already yours, one tap.
//
// It renders NOTHING for a person with one door. An icon that opens a menu
// with nothing in it is worse than no icon.
//
// A NOTE ON ROLES. Shahar listed five: "home owner, professional, admin,
// viewer, investor". Three of those are doors - separate apps on one login.
// Viewer and investor are not: they are LENSES on a single project (the
// `as=` switch on a project screen, migration-era lens.ts), because what a
// viewer or an investor sees is one job seen differently, not a different
// app. They belong where they already are, inside the project.
export async function DoorSwitchIcon({ current }: { current: DoorKey }) {
  const doors = await loadDoors();
  if (!doors.signed_in) return null;

  const yours = DOOR_ORDER.filter((k) => doors.held.includes(k));
  if (yours.length < 2) return null;
  const others = yours.filter((k) => k !== current);
  if (others.length === 0) return null;

  return (
    <details className="door-pop">
      <summary className="btn btn-ghost btn-icon" aria-label="Switch door" title="Switch door">
        {/* Two arrows passing: the one glyph that reads as "swap", not as
            "settings" or "more". */}
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
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
