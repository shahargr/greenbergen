// Line art for the TRADES, in the same blueprint hand as Illustrations.tsx:
// one stroke colour, currentColor, no fill that carries meaning.
//
// Shahar (2026-09-14): "Each trade should be presented in a panel with the
// image of the trade and # of tasks not completed."
//
// The package illustrations could not do this job. They are drawn for things
// a homeowner BUYS - a water heater, a toilet, an EV charger - and a trade is
// not a thing, it is the work. Where one of them genuinely fits a trade
// (Painting, Windows, Siding, Gutters, Solar, Stairs) trades.illustration
// points straight at it and nothing is drawn twice; the rest are here.
//
// A trade with nothing to show gets the generic mark rather than somebody
// else's picture, which is honest and reads as "no art yet".

type P = { className?: string };

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Frame({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 120 80" className={className} aria-hidden {...base}>
      {children}
    </svg>
  );
}

// Studs and a top plate: the wall before it is a wall.
const Framing = ({ className }: P) => (
  <Frame className={className}>
    <path d="M18 18h84M18 66h84" />
    <path d="M28 18v48M50 18v48M72 18v48M94 18v48" />
    <path d="M28 42h22M72 42h22" opacity=".55" />
    <path d="M18 72h84" opacity=".4" />
  </Frame>
);

// Courses of block, staggered.
const Masonry = ({ className }: P) => (
  <Frame className={className}>
    <path d="M20 20h80v40H20z" />
    <path d="M20 33h80M20 47h80" />
    <path d="M46 20v13M73 20v13M33 33v14M60 33v14M87 33v14M46 47v13M73 47v13" />
    <path d="M16 66h88" opacity=".45" />
  </Frame>
);

// A pipe run with a valve on it.
const Plumbing = ({ className }: P) => (
  <Frame className={className}>
    <path d="M22 26h28a8 8 0 0 1 8 8v18a8 8 0 0 0 8 8h32" />
    <path d="M22 20v12M98 54v12" />
    <circle cx="58" cy="43" r="6" />
    <path d="M58 37v-8M52 29h12" />
    <path d="M30 26v-6M30 26v6" opacity=".5" />
  </Frame>
);

// A bolt through a socket plate.
const Electrical = ({ className }: P) => (
  <Frame className={className}>
    <rect x="30" y="16" width="38" height="48" rx="6" />
    <circle cx="43" cy="34" r="3" /><circle cx="55" cy="34" r="3" />
    <path d="M43 44h12" />
    <path d="M84 20l-12 20h10l-8 20" />
    <path d="M18 70h84" opacity=".4" />
  </Frame>
);

// A duct and a register.
const Hvac = ({ className }: P) => (
  <Frame className={className}>
    <rect x="18" y="24" width="34" height="32" rx="4" />
    <path d="M24 32h22M24 40h22M24 48h22" opacity=".6" />
    <path d="M52 40h22v-14h28v28H74V40" />
    <path d="M88 34v12M82 40h12" opacity=".55" />
  </Frame>
);

// A pitched roof with shingle courses.
const Roofing = ({ className }: P) => (
  <Frame className={className}>
    <path d="M16 54L60 18l44 36" />
    <path d="M28 54l32-26 32 26" opacity=".55" />
    <path d="M40 54l20-16 20 16" opacity=".35" />
    <path d="M16 54h88v10H16z" />
    <path d="M40 64v-10M68 64v-10" opacity=".5" />
  </Frame>
);

// A bucket and a slope: the ground being moved.
const Excavation = ({ className }: P) => (
  <Frame className={className}>
    <path d="M18 64h84" />
    <path d="M18 64c14-2 22-14 34-14s16 8 26 8 12-6 24-6" opacity=".5" />
    <path d="M34 20h26l10 18H34z" />
    <path d="M34 38l-8 10h52l-6-10" />
    <path d="M60 20l22 8" />
    <path d="M82 28l8 6" />
  </Frame>
);

// Boards and a taped seam.
const Drywall = ({ className }: P) => (
  <Frame className={className}>
    <path d="M20 16h36v48H20zM64 16h36v48H64z" />
    <path d="M56 16v48M64 16v48" opacity=".5" />
    <path d="M60 20v40" strokeDasharray="3 4" />
    <path d="M28 40h20M72 40h20" opacity=".45" />
    <path d="M16 70h88" opacity=".4" />
  </Frame>
);

// Batts between studs.
const Insulation = ({ className }: P) => (
  <Frame className={className}>
    <path d="M24 16v48M60 16v48M96 16v48" />
    <path d="M28 22c10 4 18-4 28 0M28 34c10 4 18-4 28 0M28 46c10 4 18-4 28 0M28 58c10 4 18-4 28 0" opacity=".7" />
    <path d="M64 22c10 4 18-4 28 0M64 34c10 4 18-4 28 0M64 46c10 4 18-4 28 0M64 58c10 4 18-4 28 0" opacity=".7" />
  </Frame>
);

// Tiles running to a corner.
const Flooring = ({ className }: P) => (
  <Frame className={className}>
    <path d="M18 28h84v36H18z" />
    <path d="M18 40h84M18 52h84" />
    <path d="M46 28v36M74 28v36" />
    <path d="M18 28l14-12h84l-14 12" opacity=".5" />
    <path d="M102 28l14-12" opacity=".35" />
  </Frame>
);

// A slab, screeded.
const Concrete = ({ className }: P) => (
  <Frame className={className}>
    <path d="M16 44h88v20H16z" />
    <path d="M16 44l12-14h88l-12 14" opacity=".55" />
    <path d="M104 44l12-14v20l-12 14" opacity=".35" />
    <circle cx="36" cy="54" r="2" opacity=".6" /><circle cx="58" cy="57" r="2" opacity=".6" />
    <circle cx="78" cy="52" r="2" opacity=".6" />
    <path d="M30 30h56" opacity=".4" />
  </Frame>
);

// A saw over a board.
const Carpentry = ({ className }: P) => (
  <Frame className={className}>
    <path d="M18 52h84v12H18z" />
    <path d="M26 52l52-30" />
    <path d="M26 52l4 6 52-30-4-6z" />
    <path d="M78 22l10-6 8 8-10 6" />
    <path d="M30 58l4 4M40 52l4 4M50 46l4 4M60 40l4 4M70 34l4 4" opacity=".5" />
  </Frame>
);

// A door in its frame, swinging.
const Doors = ({ className }: P) => (
  <Frame className={className}>
    <path d="M34 14h44v52H34z" />
    <path d="M42 14v52" opacity=".5" />
    <circle cx="70" cy="42" r="2.5" />
    <path d="M78 66c0-18-14-32-32-32" strokeDasharray="3 4" opacity=".6" />
    <path d="M24 70h72" opacity=".4" />
  </Frame>
);

// Plants and a bed edge.
const Landscaping = ({ className }: P) => (
  <Frame className={className}>
    <path d="M16 62h88" />
    <path d="M34 62V40M34 48c-8 0-12-6-12-6s6-4 12 2M34 46c8 0 12-6 12-6s-6-4-12 2" />
    <path d="M66 62V44a10 10 0 0 1 20 0v18" opacity=".7" />
    <path d="M66 52h20" opacity=".5" />
    <path d="M16 68c14-4 26 2 40-1s26 3 48-1" opacity=".45" />
  </Frame>
);

// A tripod and a stake: the ground being measured.
const Survey = ({ className }: P) => (
  <Frame className={className}>
    <path d="M40 24h20v10H40z" />
    <path d="M50 34v6M36 66l14-26M64 66l-14-26M50 40v26" />
    <path d="M60 28h14" />
    <path d="M88 18v46M82 64h12" />
    <path d="M88 26h8M88 36h8M88 46h8" opacity=".55" />
    <path d="M20 70h84" opacity=".4" />
  </Frame>
);

// A drawing on the board, with a scale rule.
const Architecture = ({ className }: P) => (
  <Frame className={className}>
    <path d="M20 14h68v52H20z" />
    <path d="M32 54V32h20v22M52 42h16v12" />
    <path d="M32 32l10-8 10 8" />
    <path d="M20 60h68" opacity=".45" />
    <path d="M96 18v48" />
    <path d="M92 26h8M92 34h8M92 42h8M92 50h8M92 58h8" opacity=".55" />
  </Frame>
);

// The generic mark: a trade with no picture yet. A square and a rule -
// deliberately plain, so it reads as "not drawn" rather than as a thing.
const Trade = ({ className }: P) => (
  <Frame className={className}>
    <rect x="30" y="20" width="60" height="40" rx="6" opacity=".8" />
    <path d="M42 34h36M42 46h22" opacity=".55" />
    <path d="M20 70h80" opacity=".35" />
  </Frame>
);

export const TRADE_ART: Record<string, (p: P) => React.JSX.Element> = {
  framing: Framing,
  masonry: Masonry,
  plumbing: Plumbing,
  electrical: Electrical,
  hvac: Hvac,
  roofing: Roofing,
  excavation: Excavation,
  drywall: Drywall,
  insulation: Insulation,
  flooring: Flooring,
  concrete: Concrete,
  carpentry: Carpentry,
  doors: Doors,
  landscaping: Landscaping,
  survey: Survey,
  architecture: Architecture,
  trade: Trade,
};
