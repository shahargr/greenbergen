// A folded map with a car on the road below it: the sign for "take me there".
export function MapCarIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {/* the map, folded in three */}
      <path d="M2.5 5.5 8.5 3.5 15.5 6 21.5 4v8.5" />
      <path d="M8.5 3.5v8M15.5 6v5" />
      {/* the road, and the car on it */}
      <path d="M2.5 21h19" />
      <path d="M6 18.5 7.2 15h7.6l2.2 3.5" />
      <path d="M5 18.5h13.5" />
      <circle cx="8.2" cy="18.6" r="1.15" />
      <circle cx="15.2" cy="18.6" r="1.15" />
    </svg>
  );
}
