"use client";

import type { ReactNode } from "react";

// TAKE ME THERE - the address, handed to whatever map application the phone
// in your hand actually uses.
//
// Shahar (2026-09-17): "when clicking on site visit, open URL with device map
// application to navigate there."
//
// THERE IS NO ONE URL THAT DOES THIS. Android and the desktop want Google's
// directions link, which its app claims; an iPhone wants maps.apple.com,
// which Apple Maps claims. Sniffing the device during render is both impure
// (react-hooks/purity) and wrong on a server, where there is no device - so
// the link is RENDERED as the Google one, which works everywhere, and the
// click swaps it for Apple's when the click happens to come from an Apple
// device. The choice is made in the one place that knows: the tap.
//
// Both are https links on purpose rather than the geo: and maps: schemes.
// A scheme the device does not claim is a dead tap with no error; an https
// link either opens the app that claims it or opens the same map in the
// browser, which is a worse outcome but never a broken one.
const enc = (s: string) => encodeURIComponent(s.replace(/\s+/g, " ").trim());
const google = (a: string) => `https://www.google.com/maps/dir/?api=1&destination=${enc(a)}&travelmode=driving`;
const apple = (a: string) => `https://maps.apple.com/?daddr=${enc(a)}&dirflg=d`;

const isApple = () => {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac, hence the touch check; Android must lose
  // this test even though some Android browsers say "like Mac OS X".
  if (/Android/i.test(ua)) return false;
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
};

export function MapLink({ address, className, title, children }: {
  address: string;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <a
      href={google(address)}
      className={className}
      title={title ?? `Navigate to ${address}`}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => {
        // Only ever REDIRECTS an Apple device; everybody else follows the
        // href that is already there, including with JavaScript off.
        if (typeof navigator === "undefined" || !isApple()) return;
        e.preventDefault();
        window.open(apple(address), "_blank", "noreferrer");
      }}
    >
      {children}
    </a>
  );
}
