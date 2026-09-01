// Local weather for the signed-in dashboard. Open-Meteo: free, no key.
// One geocode + one forecast call, cached 30 minutes; any failure returns
// null and the card renders a quiet dash - weather must never break the page.

export type WeatherIcon = "sun" | "partly" | "cloud" | "fog" | "rain" | "snow" | "storm";

export type Weather = {
  tempF: number;
  label: string;
  icon: WeatherIcon;
};

function codeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Mostly clear";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Stormy";
}

export function codeIcon(code: number): WeatherIcon {
  if (code === 0) return "sun";
  if (code <= 2) return "partly";
  if (code === 3) return "cloud";
  if (code === 45 || code === 48) return "fog";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain";
  if (code <= 86) return "snow";
  return "storm";
}

export type ForecastDay = {
  date: string;
  hi: number;
  lo: number;
  label: string;
  icon: WeatherIcon;
};

async function geocode(town: string) {
  const geoRes = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(town)}&count=1&country_code=US`,
    { next: { revalidate: 1800 } },
  );
  const geo = await geoRes.json();
  return geo?.results?.[0] ?? null;
}

// Five-day outlook for the dashboard's weather drill-down. Same rules as
// getWeather: cached, keyless, fails to null.
export async function getForecast(town: string | null): Promise<ForecastDay[] | null> {
  if (!town) return null;
  try {
    const hit = await geocode(town);
    if (!hit) return null;
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code&temperature_unit=fahrenheit&forecast_days=5&timezone=America%2FNew_York`,
      { next: { revalidate: 1800 } },
    );
    const wx = await res.json();
    const d = wx?.daily;
    if (!d?.time?.length) return null;
    return d.time.map((date: string, i: number) => ({
      date,
      hi: Math.round(d.temperature_2m_max[i]),
      lo: Math.round(d.temperature_2m_min[i]),
      label: codeLabel(d.weather_code[i] ?? 3),
      icon: codeIcon(d.weather_code[i] ?? 3),
    }));
  } catch {
    return null;
  }
}

export async function getWeather(town: string | null): Promise<Weather | null> {
  if (!town) return null;
  try {
    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(town)}&count=1&country_code=US`,
      { next: { revalidate: 1800 } },
    );
    const geo = await geoRes.json();
    const hit = geo?.results?.[0];
    if (!hit) return null;

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}&current=temperature_2m,weather_code&temperature_unit=fahrenheit`,
      { next: { revalidate: 1800 } },
    );
    const wx = await wxRes.json();
    const temp = wx?.current?.temperature_2m;
    const code = wx?.current?.weather_code;
    if (typeof temp !== "number") return null;

    const c = typeof code === "number" ? code : 3;
    return { tempF: Math.round(temp), label: codeLabel(c), icon: codeIcon(c) };
  } catch {
    return null;
  }
}
