// A car. It sits on the Navigate button, which opens driving directions.
export function CarIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden focusable="false">
      {/* body: bonnet, cabin, boot */}
      <path d="M3.5 16.6v-3.1l1.9-4.4A2 2 0 0 1 7.2 7.8h9.6a2 2 0 0 1 1.8 1.3l1.9 4.4v3.1" />
      {/* beltline under the windows */}
      <path d="M3.5 13.5h17" />
      {/* wheels, and the road between them */}
      <circle cx="7.4" cy="16.9" r="1.7" />
      <circle cx="16.6" cy="16.9" r="1.7" />
      <path d="M9.1 16.9h5.8" />
    </svg>
  );
}
