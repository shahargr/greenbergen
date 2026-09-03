"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const I = {
  width: 17, height: 17, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.9,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const SECTIONS = [
  {
    href: "/admin", label: "Overview",
    icon: <svg {...I}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  },
  {
    href: "/admin/photos", label: "Public pages",
    icon: <svg {...I}><rect x="3" y="4" width="18" height="14" rx="2" /><circle cx="8.5" cy="9" r="1.6" /><path d="m3 16 5-4 4 3 4-4 5 5" /></svg>,
  },
  {
    href: "/admin/users", label: "Users",
    icon: <svg {...I}><circle cx="9" cy="8" r="3.4" /><path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><circle cx="17" cy="9" r="2.6" /><path d="M17.5 14.6c2.2.5 3.5 2.2 3.5 4.4" /></svg>,
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
  {
    href: "/admin/projects", label: "Projects",
    icon: <svg {...I}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></svg>,
  },
];

function isActive(href: string, path: string) {
  return href === "/admin" ? path === "/admin" : path.startsWith(href);
}

// Admin section navigation: a left sidebar on desktop, a compact section
// dropdown (same idiom as the role switcher) on narrow screens.
export function AdminNav() {
  const path = usePathname();
  const current = SECTIONS.find((s) => isActive(s.href, path)) ?? SECTIONS[0];

  return (
    <>
      <aside className="admin-side">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href}
            className={isActive(s.href, path) ? "admin-side-item active" : "admin-side-item"}>
            {s.icon} {s.label}
          </Link>
        ))}
      </aside>

      <details className="rolemenu admin-sectionmenu">
        <summary><span className="rolemenu-current">{current.icon} {current.label} ▾</span></summary>
        <div className="rolemenu-list">
          {SECTIONS.map((s) =>
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
