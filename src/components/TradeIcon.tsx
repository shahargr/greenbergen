// Small stroke icons per trade for the trade stat tiles; anything unmapped
// gets the generic tools glyph.
const S = {
  width: 22, height: 22, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.8,
  strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};

const ICONS: Record<string, React.ReactNode> = {
  Framing: <svg {...S}><path d="M3 21V7l9-4 9 4v14" /><path d="M7 21v-8h10v8" /><path d="M12 3v6" /></svg>,
  Plumbing: <svg {...S}><path d="M12 3c-3 4-5 6.5-5 9a5 5 0 0 0 10 0c0-2.5-2-5-5-9z" /></svg>,
  HVAC: <svg {...S}><circle cx="12" cy="12" r="2.2" /><path d="M12 9.8C12 6.4 13.9 5 16.3 5.4c.4 2.5-1 4.4-4.3 4.4zM14.2 12c3.4 0 4.8 1.9 4.4 4.3-2.5.4-4.4-1-4.4-4.3zM12 14.2c0 3.4-1.9 4.8-4.3 4.4-.4-2.5 1-4.4 4.3-4.4zM9.8 12c-3.4 0-4.8-1.9-4.4-4.3 2.5-.4 4.4 1 4.4 4.3z" /></svg>,
  Electrical: <svg {...S}><path d="m13 2-8 12h6l-2 8 8-12h-6z" /></svg>,
  Masonry: <svg {...S}><rect x="3" y="5" width="18" height="14" rx="1" /><path d="M3 12h18M9 5v7M15 12v7" /></svg>,
  Roofing: <svg {...S}><path d="M2 13 12 4l10 9" /><path d="M6 9.5 12 15l6-5.5" /></svg>,
  Landscaping: <svg {...S}><path d="M12 3 7 11h3l-4 7h12l-4-7h3z" /><path d="M12 18v3" /></svg>,
  Windows: <svg {...S}><rect x="4" y="4" width="16" height="16" rx="1.5" /><path d="M12 4v16M4 12h16" /></svg>,
  Insulation: <svg {...S}><path d="M4 6h16v12H4z" /><path d="M4 12c2-2 4 2 6 0s4 2 6 0 4 2 4 0" /></svg>,
  Drywall: <svg {...S}><rect x="4" y="3" width="16" height="18" rx="1" /><path d="M12 3v18M4 9h8M12 15h8" /></svg>,
  Painting: <svg {...S}><rect x="5" y="3" width="14" height="6" rx="1" /><path d="M19 5h2v5H12v4" /><rect x="10.5" y="14" width="3" height="7" rx="1" /></svg>,
  Flooring: <svg {...S}><path d="M3 7l9-4 9 4-9 4z" /><path d="M3 12l9 4 9-4M3 17l9 4 9-4" /></svg>,
  Demolition: <svg {...S}><path d="m14.5 9.5 6 6L18 18l-6-6" /><path d="M3.3 6.8 6 4l4.4 4.4a2 2 0 0 1 0 2.8l-.2.2a2 2 0 0 1-2.8 0z" /><path d="m5 21 5.5-5.5" /></svg>,
  "Interior Design": <svg {...S}><path d="M4 20c0-6 3-9 8-9s8 3 8 9" /><path d="M12 11V4M9 6l3-2 3 2" /></svg>,
  Excavation: <svg {...S}><path d="M3 19h18" /><path d="M5 19v-4l6-2 2-6 5 2-1 5-4 1-2 4" /></svg>,
  Gutters: <svg {...S}><path d="M3 6h18v4H3z" /><path d="M17 10v8a2 2 0 1 1-4 0" /></svg>,
};

const Fallback = (
  <svg {...S}><path d="M14.7 6.3a4 4 0 0 0-5.2 5.2L4 17v3h3l5.5-5.5a4 4 0 0 0 5.2-5.2L15 12l-3-3z" /></svg>
);

export function TradeIcon({ trade }: { trade: string }) {
  return <>{ICONS[trade] ?? Fallback}</>;
}
