// US address verification via the Census Bureau geocoder - official, free,
// keyless. Returns the standardized address on a match, null when the
// address cannot be verified. Never throws: verification is advisory and
// must not block a save.

// Same geocoder, with coordinates - for anything that needs to know how far
// apart two houses are (deal clusters). Null when unmatched; never throws.
export async function geocodeUsAddress(address: string): Promise<{ matched: string; lat: number; lng: number } | null> {
  if (!address.trim()) return null;
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
      `?address=${encodeURIComponent(address.trim())}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    const x = Number(match?.coordinates?.x), y = Number(match?.coordinates?.y);
    if (!match?.matchedAddress || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { matched: match.matchedAddress, lat: y, lng: x };
  } catch {
    return null;
  }
}

export async function verifyUsAddress(address: string): Promise<string | null> {
  if (!address.trim()) return null;
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
      `?address=${encodeURIComponent(address.trim())}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { next: { revalidate: 0 } });
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    return match?.matchedAddress ?? null;
  } catch {
    return null;
  }
}
