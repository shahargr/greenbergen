// Line illustrations, blueprint style: one stroke colour (currentColor), no
// fills that carry meaning. Illustrations, never photos - the spec's rule.
// Keyed by blueprint_packages.illustration.

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

export const WaterHeater = ({ className }: P) => (
  <Frame className={className}>
    <rect x="44" y="14" width="30" height="52" rx="6" />
    <path d="M52 14v-6M66 14v-6M56 8h6" />
    <path d="M59 66v8M40 74h38" />
    <path d="M44 30h30M44 50h30" strokeDasharray="2 3" />
    <circle cx="59" cy="40" r="3" />
    <path d="M74 22h14v20M20 60h24" />
    <path d="M14 74h92" opacity=".5" />
    <path d="M22 20v40M22 20h12" />
  </Frame>
);

export const Toilet = ({ className }: P) => (
  <Frame className={className}>
    <path d="M40 20h26v26H40z" />
    <path d="M44 20v-6h18v6" />
    <path d="M30 46h50c0 14-10 24-25 24S30 60 30 46z" />
    <path d="M38 70v6h34v-6" />
    <path d="M40 48h30" strokeDasharray="2 3" />
    <circle cx="60" cy="16" r="1.6" />
  </Frame>
);

export const Faucet = ({ className }: P) => (
  <Frame className={className}>
    <path d="M40 60h40" />
    <path d="M52 60V38c0-10 6-14 14-14h8c6 0 10 4 10 10v6" />
    <path d="M80 40h8v8h-8z" />
    <path d="M60 24v-8h8v8" />
    <path d="M84 48v14" strokeDasharray="2 3" />
    <path d="M20 66c10 6 70 6 80 0" opacity=".6" />
  </Frame>
);

export const Driveway = ({ className }: P) => (
  <Frame className={className}>
    <path d="M52 14h16l26 60H26z" />
    <path d="M60 22v6M60 36v8M60 52v10" strokeDasharray="3 4" />
    <path d="M10 74h100" opacity=".5" />
    <path d="M30 14h14v10H30zM76 14h14v10H76z" opacity=".7" />
  </Frame>
);

export const Painting = ({ className }: P) => (
  <Frame className={className}>
    <path d="M30 16h50v14H30z" />
    <path d="M80 23h10v12H62v10" />
    <path d="M58 45h8v26h-8z" />
    <path d="M34 30l-4 44M36 30l8 44" opacity=".5" />
    <path d="M14 22h8M14 40h8M14 58h8" opacity=".4" />
  </Frame>
);

export const EvCharger = ({ className }: P) => (
  <Frame className={className}>
    <rect x="30" y="14" width="26" height="56" rx="3" />
    <rect x="36" y="20" width="14" height="10" />
    <path d="M43 40l-4 8h8l-4 8" />
    <path d="M56 30h10c6 0 8 4 8 10v14c0 6 4 8 10 8h6" />
    <path d="M86 56h8v10h-8z" />
    <path d="M14 74h92" opacity=".5" />
  </Frame>
);

export const Generator = ({ className }: P) => (
  <Frame className={className}>
    <rect x="24" y="30" width="60" height="36" rx="3" />
    <path d="M24 42h60" />
    <path d="M30 48h10M30 54h10M30 60h10" opacity=".7" />
    <path d="M64 50l-4 6h8l-4 6" />
    <path d="M14 70h80v6H14z" />
    <path d="M84 40h12v-6h8" />
    <path d="M40 30v-8h28v8" opacity=".6" />
  </Frame>
);

export const Gutters = ({ className }: P) => (
  <Frame className={className}>
    <path d="M16 40 60 12l44 28" />
    <path d="M12 42h96v6H12z" />
    <path d="M96 48v26M92 74h8" />
    <path d="M28 48v22M88 48v22" opacity=".4" />
    <path d="M40 30l3 6M50 26l3 6M60 22l3 6" opacity=".6" />
  </Frame>
);

export const Window = ({ className }: P) => (
  <Frame className={className}>
    <rect x="34" y="14" width="52" height="52" />
    <path d="M60 14v52M34 40h52" />
    <path d="M28 66h64v6H28z" />
    <path d="M40 20l10 10M44 20l10 10" opacity=".4" />
  </Frame>
);

export const Blinds = ({ className }: P) => (
  <Frame className={className}>
    <rect x="30" y="12" width="60" height="56" />
    <path d="M30 20h60M30 28h60M30 36h60M30 44h60" />
    <path d="M30 52h60M30 60h60" opacity=".4" />
    <path d="M84 44v22" strokeDasharray="2 3" />
    <circle cx="84" cy="68" r="2" />
    <path d="M14 74h92" opacity=".5" />
  </Frame>
);

export const Fence = ({ className }: P) => (
  <Frame className={className}>
    <path d="M20 30l6-8 6 8v44H20zM44 30l6-8 6 8v44H44zM68 30l6-8 6 8v44H68zM92 30l6-8 6 8v44H92z" />
    <path d="M14 40h96M14 60h96" />
  </Frame>
);

export const Siding = ({ className }: P) => (
  <Frame className={className}>
    <path d="M20 34 60 10l40 24v40H20z" />
    <path d="M20 42h80M20 50h80M20 58h80M20 66h80" opacity=".6" />
    <rect x="52" y="48" width="16" height="26" />
  </Frame>
);

export const Solar = ({ className }: P) => (
  <Frame className={className}>
    <path d="M18 40 60 14l42 26" />
    <path d="M30 34h26v16H30zM60 34h26v16H60z" />
    <path d="M43 34v16M73 34v16M30 42h56" opacity=".6" />
    <circle cx="98" cy="14" r="5" />
    <path d="M98 4v3M108 14h-3M105 7l-2 2" opacity=".7" />
    <path d="M20 74h80" opacity=".5" />
  </Frame>
);

export const Basement = ({ className }: P) => (
  <Frame className={className}>
    <path d="M14 30h92v44H14z" />
    <path d="M14 30 60 8l46 22" opacity=".6" />
    <path d="M30 74V52h20v22" />
    <path d="M70 44h24v14H70z" opacity=".6" />
    <path d="M14 30v-6M106 30v-6" />
  </Frame>
);

export const Kitchen = ({ className }: P) => (
  <Frame className={className}>
    <path d="M16 44h88v30H16z" />
    <path d="M16 44h88v-6H16z" />
    <path d="M40 50v18M64 50v18" opacity=".5" />
    <path d="M70 38v-8h22v8" />
    <path d="M28 38v-8c0-4 4-6 8-6" opacity=".7" />
    <path d="M30 16h40v12H30z" opacity=".5" />
  </Frame>
);

export const Bathroom = ({ className }: P) => (
  <Frame className={className}>
    <path d="M16 46h88v10c0 10-8 18-18 18H34c-10 0-18-8-18-18z" />
    <path d="M24 46V22c0-6 4-10 10-10s10 4 10 10" />
    <path d="M44 22h6v6h-6z" />
    <path d="M30 74v4M90 74v4" />
  </Frame>
);

export const SomethingElse = ({ className }: P) => (
  <Frame className={className}>
    <path d="M30 20h60v36H40l-10 10z" />
    <path d="M42 32h36M42 42h24" opacity=".6" />
  </Frame>
);

export const Salt = ({ className }: P) => (
  <Frame className={className}>
    <path d="M30 34h26v36H30zM64 34h26v36H64z" />
    <path d="M34 34v-6h18v6M68 34v-6h18v6" />
    <path d="M36 46h14M70 46h14" opacity=".6" />
    <path d="M20 14l2 2M40 10l2 2M60 16l2 2M84 10l2 2M100 18l2 2" />
    <path d="M14 74h92" opacity=".5" />
  </Frame>
);

export const House = ({ className }: P) => (
  <Frame className={className}>
    <path d="M18 40 60 12l42 28" />
    <path d="M26 36v38h68V36" />
    <path d="M52 74V52h16v22" />
    <path d="M34 46h10v10H34zM76 46h10v10H76z" />
    <path d="M10 74h100" opacity=".5" />
  </Frame>
);

export const Steps = ({ className }: P) => (
  <Frame className={className}>
    <path d="M14 64h30V44h30V24h32" />
    <circle cx="28" cy="58" r="4" />
    <circle cx="58" cy="38" r="4" opacity=".5" />
    <circle cx="90" cy="18" r="4" opacity=".5" />
    <path d="M14 74h92" opacity=".4" />
  </Frame>
);

export const Checkmark = ({ className }: P) => (
  <Frame className={className}>
    <circle cx="60" cy="40" r="26" />
    <path d="m46 41 9 9 19-20" />
  </Frame>
);

// The last mile: a router on a shelf, throwing signal. Bills & services is
// the one section that is not construction at all.
export const InternetTv = ({ className }: P) => (
  <Frame className={className}>
    <rect x="34" y="46" width="52" height="14" rx="3" />
    <circle cx="44" cy="53" r="2" />
    <path d="M54 53h24" opacity=".4" />
    <path d="M70 46V34" />
    <path d="M78 46V38" />
    <path d="M50 34a18 18 0 0 1 26 0" opacity=".55" />
    <path d="M44 26a30 30 0 0 1 38 0" opacity=".35" />
    <path d="M14 74h92" opacity=".5" />
  </Frame>
);

// A unit heater hung from the garage ceiling, blowing down. The louvres are
// the tell - it is the shape people recognise from a workshop, not a furnace.
export const GarageHeater = ({ className }: P) => (
  <Frame className={className}>
    <path d="M40 14v6M60 14v6M80 14v6" opacity=".5" />
    <rect x="36" y="20" width="48" height="26" rx="4" />
    <path d="M42 28h36M42 34h36" opacity=".55" />
    <path d="M84 30h12" />
    <path d="M48 46l-4 12M60 46v14M72 46l4 12" opacity=".7" />
    <path d="M22 68h76" opacity=".5" />
    <path d="M22 68V40M98 68V40" opacity=".35" />
  </Frame>
);

// A pop-up head throwing an arc. Ground line low, so it reads as lawn.
export const Sprinklers = ({ className }: P) => (
  <Frame className={className}>
    <path d="M34 66V50" />
    <rect x="30" y="66" width="8" height="6" rx="2" />
    <path d="M38 48a34 34 0 0 1 44 20" />
    <path d="M40 40a30 30 0 0 1 32 8" opacity=".5" />
    <path d="M44 32a24 24 0 0 1 20 4" opacity=".3" />
    <path d="M86 66h6M92 62v8" opacity=".45" />
    <path d="M14 72h92" opacity=".5" />
  </Frame>
);

const MAP: Record<string, (p: P) => React.JSX.Element> = {
  water_heater: WaterHeater, toilet: Toilet, faucet: Faucet, driveway: Driveway, painting: Painting,
  ev_charger: EvCharger, generator: Generator, gutters: Gutters, blinds: Blinds, window: Window, fence: Fence, siding: Siding,
  solar: Solar, basement: Basement, kitchen: Kitchen, bathroom: Bathroom, something_else: SomethingElse,
  salt: Salt, house: House, steps: Steps, check: Checkmark, internet_tv: InternetTv,
  garage_heater: GarageHeater, sprinklers: Sprinklers,
};

export function Illustration({ name, className }: { name: string | null | undefined; className?: string }) {
  const C = (name && MAP[name]) || SomethingElse;
  return <C className={className} />;
}
