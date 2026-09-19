"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { read, SKILLS, type BobTile } from "@/lib/bob";

// ASK BOB. You type what is going on in your own words; he answers as you
// type, out of what he actually knows.
//
// NOTHING IS SENT ANYWHERE. The read is a pure function over four skill
// definitions and the live catalogue, run in the browser - so it answers with
// no round trip, works before anybody has an account, and never quietly files
// what somebody typed about their house. When Bob cannot help, the recording
// below him still goes to a person, which is the path that existed before him
// and is the honest end of "I do not know that one yet".

const EXAMPLES = [
  "the power keeps going out",
  "no hot water this morning",
  "I need to charge the car at home",
  "wifi dies at the far end of the house",
];

export function AskBob({ tiles, initial = "" }: { tiles: BobTile[]; initial?: string }) {
  // What was typed into the home screen's search box, handed over in ?q= and
  // answered on arrival - so the box up there is a real search box and not a
  // link wearing one.
  const [text, setText] = useState(initial);
  const answer = useMemo(() => read(text, tiles), [text, tiles]);
  const typed = text.trim().length > 0;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">What is going on?</span>
        <textarea className="input" rows={2} value={text} maxLength={600}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tell me in your own words — “the power keeps going out”" />
      </label>

      {/* WHAT HE IS GOOD AT, before you have typed anything. Four things,
          said plainly, and tapping one is the same as typing it - which is
          how somebody finds out what he knows without reading a list of
          features. */}
      {!typed && (
        <>
          <p className="small" style={{ margin: 0 }}>
            Right now I am good at four things. Anything else about the house, ask anyway — I will tell you
            straight whether it is mine.
          </p>
          <div className="chips">
            {EXAMPLES.map((e) => (
              <button key={e} type="button" className="btn btn-soft small" onClick={() => setText(e)}>{e}</button>
            ))}
          </div>
          <ul className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
            {SKILLS.map((s) => <li key={s.code}>{s.name}</li>)}
          </ul>
        </>
      )}

      {/* HE KNOWS THIS ONE. What he heard, the three questions that actually
          change the job, the one true thing worth hearing before money moves,
          and the two doors: read how it goes, or start it. */}
      {typed && answer.kind === "skill" && (
        <div className="card pad stack" style={{ gap: 10 }}>
          <div>
            <div className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>
              Bob · {answer.skill.name}
            </div>
            <p style={{ margin: "4px 0 0", fontSize: 16, lineHeight: 1.4 }}>{answer.skill.reads}</p>
          </div>

          <div>
            <div className="small" style={{ fontWeight: 700 }}>Three things I would need to know</div>
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
              {answer.skill.asks.map((q) => <li key={q}>{q}</li>)}
            </ul>
          </div>

          <p className="small" style={{ margin: 0 }}><strong>Straight answer:</strong> {answer.skill.straight}</p>

          <div className="chips">
            <Link className="btn btn-primary" href={`/packages/${answer.skill.code}`}>See what it costs</Link>
            <Link className="btn btn-soft" href={`/packages/${answer.skill.code}/how`}>How it actually goes</Link>
          </div>
        </div>
      )}

      {/* OUTSIDE HIS FOUR, but we do it. He points, and he is clear that he
          is pointing rather than helping - the difference is the whole
          reason anybody would trust the four he does claim. */}
      {typed && answer.kind === "nearby" && (
        <div className="card pad stack" style={{ gap: 8 }}>
          <div className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>
            Bob · not mine yet
          </div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4 }}>
            That sounds like <strong>{answer.tile.name}</strong>. I am not good at that one yet — I would only
            be guessing at what it takes. We do it, though, and the page is honest about the price.
          </p>
          <div className="chips">
            <Link className="btn btn-primary" href={`/packages/${answer.tile.code}`}>
              {answer.tile.availability === "quote" ? `Ask about ${answer.tile.name.toLowerCase()}` : `See ${answer.tile.name.toLowerCase()}`}
            </Link>
            <Link className="btn btn-soft" href="/packages">Everything we do</Link>
          </div>
        </div>
      )}

      {/* HE DOES NOT KNOW. Said in one sentence, without an apology and
          without a suggestion he cannot stand behind. The recording under
          this box reaches a person, and that is what he offers. */}
      {typed && answer.kind === "unknown" && (
        <div className="card pad stack" style={{ gap: 8 }}>
          <div className="tiny text-muted" style={{ textTransform: "uppercase", letterSpacing: ".06em" }}>
            Bob · I do not know that one
          </div>
          <p style={{ margin: 0, fontSize: 16, lineHeight: 1.4 }}>
            I cannot help with that yet. Today I am good at generators, water heaters, EV chargers and home
            internet — everything else about the house I am still learning.
          </p>
          <p className="small" style={{ margin: 0 }}>
            Say it in a recording below and a person comes back to you with a clear next step. That is not a
            brush-off: it is how I get better at it.
          </p>
          <div className="chips">
            <Link className="btn btn-soft" href="/packages">Everything we do</Link>
          </div>
        </div>
      )}
    </div>
  );
}
