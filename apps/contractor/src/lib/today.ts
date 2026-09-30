// TODAY, IN NEW JERSEY. Every date this app compares or fills in - a task's
// target date, a visit's day, the day a payment was made - is a calendar day
// where the work is, and toISOString() gives the calendar day in London:
// from 8pm Eastern the app was a day ahead of the site, so a task due
// tomorrow read as late and a payment logged tonight was dated tomorrow.
// en-CA is the locale whose short date is already YYYY-MM-DD.
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });

export function todayET(now: Date = new Date(), plusDays = 0): string {
  return fmt.format(plusDays ? new Date(now.getTime() + plusDays * 86400_000) : now);
}
