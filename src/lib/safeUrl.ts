// A link typed by a person (a vendor website, a banner url) only becomes an
// anchor when it is plainly http(s); anything else renders as text so a
// javascript: or data: value can never be a click target.
export function safeHttpUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  const t = u.trim();
  return /^https?:\/\//i.test(t) ? t : null;
}
