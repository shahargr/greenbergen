import MyPage from "../page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Houses · Green Bergen" };

// EVERY HOUSE, ON ITS OWN PAGE (Shahar, 2026-09-20: "Have a link showing all
// houses with a way to add/remove houses").
//
// It renders the dashboard with show="houses", which paints the houses rail
// and nothing else. The same component, not a copy of it: "same logic as
// listed here on the page, just a different page" only stays true if there is
// one piece of logic. Adding a house is the ＋ on the rail; removing one is
// the gear on each panel, both already there.
export default function HousesPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; error?: string; ok?: string; t?: string; all?: string; allp?: string; view?: string }>;
}) {
  return MyPage({ searchParams, show: "houses" });
}
