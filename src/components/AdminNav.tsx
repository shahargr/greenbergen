"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  width: 17, height: 17, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

// THE ADMIN NAVIGATION, CUT DOWN TO WHAT IS USED (Shahar, 2026-09-18: "lets
// clean up the admin navigation bar, keeping only the following and moving
// all the rest under menu").
//
// Ten flat sections, every one of them equally loud, meant you read the list
// every time to find the two you wanted. Three groups now, in the order the
// work actually happens:
//
//   Projects setup  - how a job is defined before anybody books it. DIY is
//                     the step-by-step somebody follows themselves; fully
//                     delivered is the package we run for them. Same library
//                     underneath, two ways to buy it.
//   People & jobs   - who is on the platform and what they are running.
//   Console         - the gear: the whole platform's knobs, on their own
//                     screen, with the mask and the door switch.
//
// Everything else - the reading, not the doing - is under More, one click
// away and no longer competing for the eye.
type Item = { href: string; label: string; note?: string; icon: React.ReactNode };
type Group = { key: string; title: string; items: Item[] };

const GROUPS: Group[] = [
  {
    key: "setup", title: "Projects setup",
    items: [
      {
        href: "/admin/activities", label: "DIY", note: "Step by step",
        icon: <svg {...I}><path d="M9 6h11" /><path d="M9 12h11" /><path d="M9 18h11" /><path d="m3.5 6 1.3 1.3L7.2 4.9" /><path d="m3.5 12 1.3 1.3 2.4-2.4" /><path d="m3.5 18 1.3 1.3 2.4-2.4" /></svg>,
      },
      {
        href: "/admin/packages", label: "Fully delivered", note: "Packages",
        icon: <svg {...I}><path d="M21 8 12 3 3 8l9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>,
      },
      {
        href: "/admin/payouts", label: "Payouts", note: "Placeholder",
        icon: <svg {...I}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 9.5v5" /><path d="M18 9.5v5" /></svg>,
      },
      {
        href: "/admin/markup", label: "Mark-up", note: "On top of the contractor",
        icon: <svg {...I}><path d="M19 5 5 19" /><circle cx="6.5" cy="6.5" r="2.5" /><circle cx="17.5" cy="17.5" r="2.5" /></svg>,
      },
    ],
  },
  {
    key: "people", title: "People & jobs",
    items: [
      {
        href: "/admin/users", label: "Users",
        icon: <svg {...I}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M17.5 14.6c2.2.5 3.5 2.2 3.5 4.4" /></svg>,
      },
      {
        href: "/admin/projects", label: "All projects",
        icon: <svg {...I}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>,
      },
      {
        href: "/pro/inbox?door=admin", label: "Inbox",
        icon: <svg {...I}><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z" /></svg>,
      },
      {
        href: "/my/invite", label: "Invite",
        icon: <svg {...I}><circle cx="9" cy="8" r="3.6" /><path d="M2 20c0-3.3 3-5.6 7-5.6 1.1 0 2.1.2 3 .5" /><path d="M19 8v8" /><path d="M15 12h8" /></svg>,
      },
    ],
  },
];

// The gear, on its own: it is not a section of the console, it IS the console.
const CONSOLE: Item = {
  href: "/admin/console", label: "Console",
  icon: <svg {...I}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" /></svg>,
};

// The reading, not the doing.
const MORE: Item[] = [
  {
    href: "/admin", label: "Overview",
    icon: <svg {...I}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  },
  {
    href: "/admin/site", label: "Site design",
    icon: <svg {...I}><path d="M12 3v18" /><path d="M3 12h18" /><rect x="3" y="3" width="18" height="18" rx="2" /></svg>,
  },
  {
    href: "/admin/claude", label: "Supabase permissions",
    icon: <svg {...I}><rect x="4" y="10.5" width="16" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /><circle cx="12" cy="15.5" r="1.3" /></svg>,
  },
  {
    href: "/admin/photos", label: "Public pages",
    icon: <svg {...I}><rect x="3" y="4" width="18" height="14" rx="2" /><circle cx="8.5" cy="9" r="1.6" /><path d="m3 16 5-4 4 3 4-4 5 5" /></svg>,
  },
  {
    href: "/admin/stats", label: "Usage",
    icon: <svg {...I}><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></svg>,
  },
  {
    href: "/admin/deals", label: "Deals",
    icon: <svg {...I}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8Z" /><circle cx="7" cy="7" r="1.4" /></svg>,
  },
  {
    href: "/admin/storage", label: "Storage",
    icon: <svg {...I}><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></svg>,
  },
  {
    href: "/admin/finance", label: "Finance",
    icon: <svg {...I}><circle cx="12" cy="12" r="9" /><path d="M14.8 8.8c-.5-1-1.5-1.5-2.8-1.5-1.7 0-2.9.9-2.9 2.2 0 3 6 1.6 6 4.7 0 1.4-1.3 2.3-3.1 2.3-1.5 0-2.6-.6-3.1-1.7" /><path d="M12 5.5v13" /></svg>,
  },
];

const ALL: Item[] = [...GROUPS.flatMap((g) => g.items), CONSOLE, ...MORE];

// /admin matches only itself; everything else matches its branch. A href
// carrying a query (the inbox) matches on its path alone.
function isActive(href: string, path: string) {
  const base = href.split("?")[0]!;
  return base === "/admin" ? path === "/admin" : path.startsWith(base);
}

// Module-level, not made inside AdminNav: a component declared during render
// is a new type on every render and throws its state away.
function Row({ s, path }: { s: Item; path: string }) {
  return (
    <Link href={s.href} className={isActive(s.href, path) ? "admin-side-item active" : "admin-side-item"}>
      {s.icon}
      <span className="admin-side-text">
        {s.label}
        {s.note && <span className="admin-side-note">{s.note}</span>}
      </span>
    </Link>
  );
}

export function AdminNav() {
  const path = usePathname() ?? "";
  const current = ALL.find((s) => isActive(s.href, path)) ?? MORE[0]!;
  const inMore = MORE.some((s) => isActive(s.href, path));

  return (
    <>
      <aside className="admin-side">
        {GROUPS.map((g) => (
          <div key={g.key} className="admin-side-group">
            <div className="admin-side-title">{g.title}</div>
            {g.items.map((s) => <Row key={s.href} s={s} path={path} />)}
          </div>
        ))}

        <div className="admin-side-group">
          <Row s={CONSOLE} path={path} />
          {/* Open when you are standing in it, so the thing you clicked is
              still on screen after the page loads. */}
          <details className="admin-more" open={inMore}>
            <summary className="admin-side-item">
              <svg {...I}><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h16" /></svg>
              <span className="admin-side-text">More</span>
            </summary>
            {MORE.map((s) => <Row key={s.href} s={s} path={path} />)}
          </details>
        </div>
      </aside>

      <details className="rolemenu admin-sectionmenu">
        <summary><span className="rolemenu-current">{current.icon} {current.label} ▾</span></summary>
        <div className="rolemenu-list">
          {ALL.map((s) =>
            isActive(s.href, path) ? (
              <span key={s.href} className="rolemenu-item current">{s.icon} {s.label}</span>
            ) : (
              <Link key={s.href} className="rolemenu-item" href={s.href}>{s.icon} {s.label}</Link>
            ),
          )}
        </div>
      </details>
    </>
  );
}
