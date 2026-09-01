"use client";

// The headline trades as icon tiles - 3 per row. Each label maps to a REAL
// row in the trades table (FK-enforced by vendor_register); the full catalog
// stays available in the fold beneath the grid.

type Tile = { label: string; trade: string; icon: React.ReactNode };

const S = {
  width: 26,
  height: 26,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

export const TRADE_TILES: Tile[] = [
  {
    label: "Plumber", trade: "Plumbing",
    icon: <svg {...S}><path d="M12 3c-3 4-5 6.5-5 9a5 5 0 0 0 10 0c0-2.5-2-5-5-9z" /></svg>,
  },
  {
    label: "Electrician", trade: "Electrical",
    icon: <svg {...S}><path d="M13 2 5 13h5l-1 9 8-11h-5z" /></svg>,
  },
  {
    label: "HVAC", trade: "HVAC",
    icon: <svg {...S}><circle cx="12" cy="12" r="2.4" /><path d="M12 9.6C12 6 14 4.5 16.5 5c.4 2.6-1 4.6-4.5 4.6zM14.4 12c3.6 0 5.1 2 4.6 4.5-2.6.4-4.6-1-4.6-4.5zM12 14.4c0 3.6-2 5.1-4.5 4.6-.4-2.6 1-4.6 4.5-4.6zM9.6 12c-3.6 0-5.1-2-4.6-4.5 2.6-.4 4.6 1 4.6 4.5z" /></svg>,
  },
  {
    label: "Landscape", trade: "Landscaping",
    icon: <svg {...S}><path d="M12 3 7 11h3l-4 7h12l-4-7h3z" /><path d="M12 18v3" /></svg>,
  },
  {
    label: "Hardscape", trade: "Hardscaping",
    icon: <svg {...S}><rect x="3" y="6" width="8" height="5" /><rect x="13" y="6" width="8" height="5" /><rect x="8" y="13" width="8" height="5" /></svg>,
  },
  {
    label: "Demo", trade: "Demo & Excavation",
    icon: <svg {...S}><path d="m4 20 6-6" /><path d="M9 9l6 6" /><path d="M12 6l6 6 3-3-6-6z" /></svg>,
  },
  {
    label: "Frame", trade: "Framing",
    icon: <svg {...S}><path d="M3 12 12 4l9 8" /><path d="M6 10v9h12v-9" /><path d="M9 19v-7M12 19v-9M15 19v-7" /></svg>,
  },
  {
    label: "Design", trade: "Architecture",
    icon: <svg {...S}><circle cx="12" cy="5" r="1.8" /><path d="m12 7-6 14M12 7l6 14" /><path d="M8.7 15h6.6" /></svg>,
  },
  {
    label: "GC/PM", trade: "General Contractor",
    icon: <svg {...S}><path d="M4 15a8 8 0 0 1 16 0z" /><path d="M10 8.5V6h4v2.5" /><path d="M2.5 18h19" /></svg>,
  },
  {
    label: "Showers", trade: "Glass Doors",
    icon: <svg {...S}><path d="M6 21V5a2 2 0 0 1 2-2h2" /><path d="M10 6a4 4 0 0 1 4 4" /><path d="M12 13v1M14.5 12.5l.5 1M16.5 10.5l1 .5" /></svg>,
  },
  {
    label: "Kitchens", trade: "Cabinetry",
    icon: <svg {...S}><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M12 4v16M4 12h16" /><path d="M10 8h0M14 8h0M10 16h0M14 16h0" strokeWidth="2.4" /></svg>,
  },
  {
    label: "Floor", trade: "Flooring Installer",
    icon: <svg {...S}><path d="M3 8h18M3 12h18M3 16h18" /><path d="M9 8v4M15 12v4M9 16v4M15 4v4" /><rect x="3" y="4" width="18" height="16" /></svg>,
  },
  {
    label: "Roof", trade: "Roofing",
    icon: <svg {...S}><path d="M2 13 12 4l10 9" /><path d="M6 9.5 12 15l6-5.5" /></svg>,
  },
  {
    label: "Pools", trade: "Pools & Spas",
    icon: <svg {...S}><path d="M2 15c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" /><path d="M2 19c2-1.6 4-1.6 6 0s4 1.6 6 0 4-1.6 6 0" /><path d="M8 15V6a2 2 0 0 1 4 0M12 13V6" /></svg>,
  },
  {
    label: "Media", trade: "Media & Smart Home",
    icon: <svg {...S}><rect x="3" y="5" width="18" height="12" rx="1.5" /><path d="m10.5 9 4 2.5-4 2.5z" /><path d="M9 20h6" /></svg>,
  },
  {
    label: "Mason", trade: "Masonry",
    icon: <svg {...S}><path d="M3 8h18v12H3z" /><path d="M3 12h18M3 16h18" /><path d="M9 8v4M15 8v4M6 12v4M12 12v4M18 12v4M9 16v4M15 16v4" /></svg>,
  },
  {
    label: "Paint", trade: "Painting",
    icon: <svg {...S}><rect x="4" y="4" width="13" height="6" rx="1" /><path d="M17 6h3v5l-7 2v7" /></svg>,
  },
  {
    label: "Tile", trade: "Tile",
    icon: <svg {...S}><rect x="4" y="4" width="7" height="7" /><rect x="13" y="4" width="7" height="7" /><rect x="4" y="13" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /></svg>,
  },
];

export function TradeTilesGrid({
  picked,
  onToggle,
}: {
  picked: Set<string>;
  onToggle: (trade: string) => void;
}) {
  return (
    <div className="tradetiles">
      {TRADE_TILES.map((t) => (
        <button
          key={t.label}
          type="button"
          className={picked.has(t.trade) ? "tradetile on" : "tradetile"}
          onClick={() => onToggle(t.trade)}
          aria-pressed={picked.has(t.trade)}
        >
          {t.icon}
          <span>{t.label}</span>
        </button>
      ))}
    </div>
  );
}
