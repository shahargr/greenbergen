"use client";

import { useRouter } from "next/navigation";

const BackIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 12H5" />
    <path d="m11 18-6-6 6-6" />
  </svg>
);

export function BackNav() {
  const router = useRouter();
  return (
    <button type="button" className="iconlink" title="Back" aria-label="Back" onClick={() => router.back()}>
      <BackIcon />
    </button>
  );
}
