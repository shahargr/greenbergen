import Link from "next/link";

// The hire-a-pro headline tiles: image on the panel, small text at the
// bottom. Each maps to one or more REAL trades in the directory; merged and
// deduped when shown. Pure links - the /my page renders the providers.

const S = {
  width: 30,
  height: 30,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export type HireTile = { key: string; label: string; trades: string[]; icon: React.ReactNode };

export const HIRE_TILES: HireTile[] = [
  {
    key: "waterheater", label: "Water heater", trades: ["Water Systems", "Plumbing"],
    icon: <svg {...S}><rect x="7" y="3" width="10" height="15" rx="3" /><path d="M10 21v-3M14 21v-3" /><path d="M12 7.5c-1 1.3-1.8 2.2-1.8 3.3a1.8 1.8 0 0 0 3.6 0c0-1.1-.8-2-1.8-3.3z" /></svg>,
  },
  {
    key: "hvac", label: "HVAC", trades: ["HVAC"],
    icon: <svg {...S}><circle cx="12" cy="12" r="2.2" /><path d="M12 9.8C12 6.4 13.9 5 16.3 5.4c.4 2.5-1 4.4-4.3 4.4zM14.2 12c3.4 0 4.8 1.9 4.4 4.3-2.5.4-4.4-1-4.4-4.3zM12 14.2c0 3.4-1.9 4.8-4.3 4.4-.4-2.5 1-4.4 4.3-4.4zM9.8 12c-3.4 0-4.8-1.9-4.4-4.3 2.5-.4 4.4 1 4.4 4.3z" /></svg>,
  },
  {
    key: "pest", label: "Pest control", trades: ["Pest Control"],
    icon: <svg {...S}><ellipse cx="12" cy="14" rx="4.5" ry="6" /><circle cx="12" cy="6" r="2" /><path d="M7.5 11 4 9M7.5 15H4M7.5 18 5 20M16.5 11 20 9M16.5 15H20M16.5 18 19 20" /></svg>,
  },
  {
    key: "landscaping", label: "Landscaping", trades: ["Landscaping"],
    icon: <svg {...S}><path d="M12 3 7 11h3l-4 7h12l-4-7h3z" /><path d="M12 18v3" /></svg>,
  },
  {
    key: "snow", label: "Snow removal", trades: ["Snow Removal"],
    icon: <svg {...S}><path d="M12 2v20M4 7l16 10M20 7 4 17" /><path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2" /></svg>,
  },
  {
    key: "plumber", label: "Plumber", trades: ["Plumbing"],
    icon: <svg {...S}><path d="M12 3c-3 4-5 6.5-5 9a5 5 0 0 0 10 0c0-2.5-2-5-5-9z" /></svg>,
  },
  {
    key: "ev", label: "EV charger", trades: ["Electrical"],
    icon: <svg {...S}><rect x="5" y="4" width="10" height="16" rx="2" /><path d="m11 8-3 4.5h4L9 17" /><path d="M15 9h3a2 2 0 0 1 2 2v6a2 2 0 1 1-4 0v-2" /></svg>,
  },
  {
    key: "roof", label: "Roof", trades: ["Roofing", "Gutters"],
    icon: <svg {...S}><path d="M2 13 12 4l10 9" /><path d="M6 9.5 12 15l6-5.5" /></svg>,
  },
  {
    key: "driveway", label: "Driveway", trades: ["Hardscaping", "Masonry", "Powerwashing"],
    icon: <svg {...S}><path d="M7 4 3 20M17 4l4 16" /><path d="M12 5v3M12 11v3M12 17v3" /></svg>,
  },
  {
    key: "locksmith", label: "Locksmith", trades: ["Alarms & Security", "Handyman"],
    icon: <svg {...S}><circle cx="8" cy="12" r="4.5" /><circle cx="8" cy="12" r="1.4" /><path d="M12.5 12H21M18 12v3.5M15.5 12v2.5" /></svg>,
  },
];

export function HireTilesGrid({ active }: { active?: string }) {
  return (
    <>
      <div className="tradetiles hire">
        {HIRE_TILES.map((t) => (
          <Link
            key={t.key}
            href={`/my?panel=local&t=${t.key}`}
            className={active === t.key ? "tradetile on" : "tradetile"}
          >
            {t.icon}
            <span>{t.label}</span>
          </Link>
        ))}
      </div>
      <p className="small" style={{ margin: "10px 0 0" }}>
        <Link href="/my?panel=local&all=1">Every trade →</Link>
      </p>
    </>
  );
}
