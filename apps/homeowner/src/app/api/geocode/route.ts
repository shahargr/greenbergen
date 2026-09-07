import { NextResponse, type NextRequest } from "next/server";

// Address check via the US Census geocoder - official, free, keyless. Returns
// the standardized address, coordinates and the county, so the app can say
// "outside Bergen County" honestly. Advisory: a miss never blocks a booking.
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (q.length < 5) return NextResponse.json({ ok: false, reason: "too short" });
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
      `?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    const data = await res.json();
    const match = data?.result?.addressMatches?.[0];
    if (!match?.matchedAddress) return NextResponse.json({ ok: true, found: false });
    const county: string | null = match?.geographies?.Counties?.[0]?.NAME ?? null;
    const comps = match?.addressComponents ?? {};
    return NextResponse.json({
      ok: true,
      found: true,
      matched: String(match.matchedAddress),
      lat: Number(match?.coordinates?.y),
      lng: Number(match?.coordinates?.x),
      county,
      city: comps.city ?? null,
      zip: comps.zip ?? null,
      bergen: county ? /bergen/i.test(county) : null,
    });
  } catch {
    return NextResponse.json({ ok: false, reason: "lookup unavailable" });
  }
}
