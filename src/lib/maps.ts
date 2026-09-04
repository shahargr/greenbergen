// A navigation link for an address. Apple Maps URLs open the native app on
// iPhone and a web map everywhere else, so one link serves every device.
export const mapsHref = (address: string) => `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
