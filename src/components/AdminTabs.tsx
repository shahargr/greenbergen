"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/photos", label: "Public pages" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/finance", label: "Finance" },
  { href: "/admin/projects", label: "Projects" },
];

export function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="admintabs wrap">
      {TABS.map((t) => {
        const active = t.href === "/admin" ? path === "/admin" : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={active ? "admintab active" : "admintab"}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
