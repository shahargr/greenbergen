// Einstein: the research persona, applied to a bid package (rulebook §18).
// Phase 1 (internal-first) is assembled by the caller from what the platform
// already knows — the package, every reply line by line, the comparison
// flags, each bidder's history here. Phase 2 (the model) reads ONLY that and
// returns a structured brief: ranking with reasons, risks, the questions to
// ask each bidder, a recommendation with confidence, and what it could not
// verify. It never awards; the decision stays with a person.
//
// Needs ANTHROPIC_API_KEY on the server (Vercel → Environment Variables).
// The key is read from the environment only — never logged, never returned.

export type ReviewInput = {
  package: Record<string, unknown>;
  items: { scope_item_id: string; item: string; is_required: boolean }[];
  bids: Record<string, unknown>[];
};

export type Review = {
  ranking: { bid_id: string; rank: number; reason: string }[];
  risks: { bid_id: string; risk: string }[];
  questions: { bid_id: string; question: string }[];
  recommended_bid_id: string | null;
  confidence: "high" | "medium" | "low";
  unverified: string;
};

const SYSTEM = `You are Einstein, the research persona for a homeowner's construction project.
You are reviewing the replies to ONE bid package so the owner can decide who to award it to.

Rules:
- Use ONLY the data you are given (the package, each reply's line items, terms and insurance answers, the comparison flags, and each bidder's history on this platform). Do not invent facts. Anything you would need from outside goes in "unverified".
- A missing REQUIRED scope line is a gap; the normalized total already prices gaps. Treat a countered deposit/retainage/net-days, missing workers' comp or no COI as risks, not disqualifiers, unless the package requires them.
- Prefer complete scope, accepted terms, held insurance and a good history over the lowest number.
- You recommend; you never award. Be specific and brief.

Return ONLY a JSON object, no prose, exactly this shape:
{"ranking":[{"bid_id":"<uuid>","rank":1,"reason":"..."}],
 "risks":[{"bid_id":"<uuid>","risk":"..."}],
 "questions":[{"bid_id":"<uuid>","question":"..."}],
 "recommended_bid_id":"<uuid or null>",
 "confidence":"high|medium|low",
 "unverified":"..."}`;

export async function reviewBids(input: ReviewInput):
  Promise<{ ok: true; review: Review; model: string } | { ok: false; reason: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ok: false, reason: "AI review needs ANTHROPIC_API_KEY set on the server (Vercel → Settings → Environment Variables), then redeploy." };
  }
  const model = process.env.EINSTEIN_MODEL ?? "claude-sonnet-5";
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: 2000, system: SYSTEM,
        messages: [{ role: "user", content: JSON.stringify(input) }],
      }),
    });
  } catch {
    return { ok: false, reason: "AI review could not reach the model service." };
  }
  if (!res.ok) return { ok: false, reason: `AI review failed (${res.status}).` };
  const json = (await res.json()) as { content?: { type: string; text?: string }[] };
  const text = (json.content ?? []).map((c) => c.text ?? "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, reason: "AI review returned no JSON." };
  try {
    const review = JSON.parse(m[0]) as Review;
    return { ok: true, review, model };
  } catch {
    return { ok: false, reason: "AI review returned malformed JSON." };
  }
}
