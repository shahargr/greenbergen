// US address verification via the Census Bureau geocoder - official, free,
// keyless. Returns the standardized address on a match, null when the
// address cannot be verified. Never throws: verification is advisory and
// must not block a save.

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
