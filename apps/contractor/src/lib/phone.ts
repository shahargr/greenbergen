// A phone number as the room shows it, always with its country code. Copied
// from MicFit (lib/phone.ts), which is where the texting service came from
// (migration 247); the display shape is the same on both platforms on purpose.
//
//   3479484484, (347) 948-4484, +13479484484  ->  +1 347-948-4484
//   050-123-4567, +972501234567               ->  +972 50-123-4567
//
// Numbers are stored however they were typed; this only changes how they are
// shown. Ten digits with no country code are read as American, a 05X number as
// Israeli. Anything it cannot read (a digit short, another country) comes back
// exactly as it was, rather than being dressed up as something it is not. The
// database (sms_phone_parse) is what decides whether a number can be texted.
export function formatPhone(raw: string): string {
  const t = raw.trim();
  let d = t.replace(/\D/g, "");
  if (t.startsWith("00")) d = d.slice(2);
  const intl = t.startsWith("+") || t.startsWith("00");

  if (!intl && /^[2-9]\d{9}$/.test(d)) d = `1${d}`;
  if (!intl && /^05\d{8}$/.test(d)) d = `972${d.slice(1)}`;
  if (intl && /^97205\d{8}$/.test(d)) d = `972${d.slice(4)}`;

  if (/^1[2-9]\d{9}$/.test(d)) return `+1 ${d.slice(1, 4)}-${d.slice(4, 7)}-${d.slice(7)}`;
  if (/^9725\d{8}$/.test(d)) return `+972 ${d.slice(3, 5)}-${d.slice(5, 8)}-${d.slice(8)}`;
  return raw;
}
