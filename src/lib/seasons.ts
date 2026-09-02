// Seasonal gating for Bergen County, NJ: some trades make no sense out of
// season (snow removal in July). Month numbers are 1-12; a trade absent
// from this map shows year-round.
const TRADE_SEASONS: Record<string, number[]> = {
  "Snow Removal": [11, 12, 1, 2, 3],
  "Pest Control": [3, 4, 5, 6, 7, 8, 9, 10],
  "Landscaping": [3, 4, 5, 6, 7, 8, 9, 10, 11],
  "Pools": [3, 4, 5, 6, 7, 8, 9],
  "Irrigation": [3, 4, 5, 6, 7, 8, 9, 10],
};

export function tradeInSeason(trade: string, month = new Date().getMonth() + 1): boolean {
  const months = TRADE_SEASONS[trade];
  return !months || months.includes(month);
}

// A tile is in season when at least one of its trades is.
export function tileInSeason(trades: string[], month = new Date().getMonth() + 1): boolean {
  return trades.some((t) => tradeInSeason(t, month));
}
