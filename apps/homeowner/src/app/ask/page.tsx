import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { loadTiles } from "@shared/catalogue";
import { AppBar, Card, Screen } from "@shared/ui";
import { VoiceAsk } from "@/components/VoiceAsk";
import { AskBob } from "@/components/AskBob";
import type { BobTile } from "@/lib/bob";
import { pricedAll } from "@/lib/markup";

export const dynamic = "force-dynamic";
export const metadata = { title: "Ask Bob" };

// MEET BOB (Shahar, 2026-09-19).
//
// "bob is your replica for anything house related. from DIY weekend project
// to planning a move. bob get smart over so it can better assist you. bob
// first skill is to help with emergency generators, water heater replacement,
// EV chargers, and home internet."
//
// This page was "tell us what you would like to do" - a recorder, and a
// person who listens and comes back. That is still here, underneath, and it
// is still what happens when Bob cannot help. What is new is that for four
// kinds of trouble you get an answer standing there, at nine at night, in the
// words you used to describe it.
//
// HE ADMITS WHAT HE DOES NOT KNOW, on purpose. "Gets smarter over time" is
// only a promise worth making if today's limits are stated, so the four are
// named on the page and everything outside them is handed on rather than
// guessed at.
export default async function AskPage({ searchParams }: { searchParams: Promise<{ voice?: string; q?: string }> }) {
  // ?q= is the box on the home screen, handed over whole. The search there is
  // a plain GET form so it works before any JavaScript does; this page is
  // where Bob actually reads it.
  const { voice, q } = await searchParams;
  const supabase = await createClient();
  const [signedIn, { tiles: raw }] = await Promise.all([isSignedIn(supabase), loadTiles()]);
  const tiles = await pricedAll(raw);
  // Only what Bob needs to point somewhere real, and only what is actually
  // offered - he must never hand somebody a tile that is not open yet.
  const known: BobTile[] = tiles
    .filter((t) => t.availability !== "coming_soon")
    .map((t) => ({
      code: t.code,
      name: [t.tile_title, t.tile_line2].filter(Boolean).join(" "),
      availability: t.availability,
      trade: t.trade ?? null,
    }));

  return (
    <Screen>
      <AppBar back="/" title="Bob" />
      <div className="body">
        <div className="hero">
          <h1>Meet Bob.</h1>
          <p className="lead">
            Your replica for anything house related — from a DIY weekend project to planning a move. He gets
            better the more he knows about your house. Today he is good at four things, and he will say so.
          </p>
        </div>

        <Card pad>
          <AskBob tiles={known} initial={q ?? ""} />
        </Card>

        {/* THE PATH THAT WAS ALWAYS HERE, and the end of every sentence Bob
            cannot finish: say it out loud and a person answers. */}
        <div className="divider-label" style={{ marginTop: 18 }}>Or say it out loud</div>
        <Card pad>
          <p className="small" style={{ margin: "0 0 10px" }}>
            Rather talk than type, or it is something Bob does not know yet? Record it. A person listens and comes
            back to you with a clear next step.
          </p>
          <VoiceAsk signedIn={signedIn} autoOpen={voice === "1"} resume={voice === "1"} />
        </Card>
      </div>
    </Screen>
  );
}
