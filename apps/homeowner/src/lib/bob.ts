// BOB.
//
// Shahar (2026-09-19), a new direction for the customer portal: "meet bob.
// bob is your replica for anything house related. from DIY weekend project to
// planning a move. bob get smart over so it can better assist you. bob first
// skill is to help with emergency generators, water heater replacement, EV
// chargers, and home internet."
//
// WHAT BOB IS, AND WHAT HE IS NOT. Bob is the homeowner app's persona - a
// voice over the catalogue that already exists, not a row in the database and
// not a model being asked anything. He is a replica in the sense that matters
// on a Tuesday night: you say what is going on in your own words and he knows
// what that is, what it takes, and what it costs, without you having to know
// the word for it.
//
// FOUR SKILLS, AND HE SAYS SO. Everything below is the four things he is good
// at today. Anything else the catalogue covers he will still point at - and
// he says plainly that it is not his, because a replica that pretends to know
// everything is worth nothing the first time it is wrong. That is the whole
// reason "he gets smarter over time" is a promise anybody would believe: it
// only means something if today he admits what he does not know.
//
// NO DATABASE. Shahar's choice, asked and answered on 2026-09-19: Bob is the
// homeowner app's persona. The portal and Professionals never mention him, and
// nothing here writes.

export type Skill = {
  /** The package he hands you, by its catalogue code. */
  code: string;
  name: string;
  /** What he says he heard, in his own words. */
  reads: string;
  /** What he actually asks you back - the three things that change the job. */
  asks: string[];
  /** The one true thing worth saying before you spend money. */
  straight: string;
  /** What people type when they mean this. Matched whole, longest first. */
  phrases: string[];
};

// The four, in the order Shahar named them.
export const SKILLS: Skill[] = [
  {
    code: "generator",
    name: "Emergency generator",
    reads: "You want the house to keep running when the street does not.",
    asks: [
      "How much of the house — the fridge, the heat and a few lights, or everything?",
      "Is there gas at the house, or would it run on propane?",
      "Where is the electrical panel, and how far is it from where the unit would sit?",
    ],
    straight:
      "This one is two licensed trades and a permit, whoever runs it — an electrician for the transfer switch and a plumber for the fuel. It is not a weekend job, and anybody who tells you it is has not pulled the permit.",
    phrases: [
      "standby generator", "whole house generator", "emergency generator", "backup power",
      "power keeps going out", "power goes out", "lose power", "lost power", "no power",
      "power outage", "generator", "genset", "outage", "blackout", "generac",
    ],
  },
  {
    code: "water_heater",
    name: "Water heater replacement",
    reads: "Either there is no hot water, or the tank is at the end of it.",
    asks: [
      "Tank or tankless — and do you want to stay with what is there?",
      "Gas or electric?",
      "How many people and how many bathrooms is it feeding?",
    ],
    straight:
      "A tank that is leaking is today, not next week — the failure is the floor, not the shower. If it is only lukewarm and the tank is dry underneath, you have time to choose properly.",
    phrases: [
      "hot water heater", "water heater", "no hot water", "not enough hot water",
      "cold shower", "tank is leaking", "leaking tank", "tankless", "rusty water",
      "water is cold", "hot water",
    ],
  },
  {
    code: "ev_charger",
    name: "EV charger",
    reads: "You want to charge at home overnight instead of planning your week around a public stall.",
    asks: [
      "Which car, and does it already come with a charger?",
      "How far is the parking spot from the panel, and what is between them?",
      "Is there room left in the panel, or is it full?",
    ],
    straight:
      "The charger is the cheap part. What moves the price is the run from the panel to the car and whether the panel has room — so the number anybody quotes before they have seen your panel is a guess.",
    phrases: [
      "ev charger", "car charger", "level 2", "level two", "charging station",
      "charge my car at home", "charge the car at home", "charge my car", "charge the car",
      "charge at home", "charge it at home", "wall connector", "wallbox", "electric car",
      "electric vehicle", "tesla", "charger",
    ],
  },
  {
    code: "internet_tv",
    name: "Home internet",
    reads: "Either the signal does not reach where you need it, or you are paying too much for it.",
    asks: [
      "What are you paying now, and what is the plan meant to be?",
      "Where does it drop out — one room, the far end, outside?",
      "How big is the house, and is the box in a closet or a basement?",
    ],
    straight:
      "Half the time this is the bill, not the wiring: the same service costs less than you are paying and one phone call fixes it. That is worth checking before anybody runs a cable.",
    phrases: [
      "home internet", "wifi", "wi fi", "wi-fi", "dead spot", "dead zone", "no signal upstairs",
      "slow internet", "internet is slow", "cable bill", "internet bill", "router", "mesh",
      "optimum", "comcast", "xfinity", "verizon", "fios", "streaming", "internet", "tv bill",
    ],
  },
];

export const skillByCode = (code: string) => SKILLS.find((s) => s.code === code) ?? null;

// A tile, as little of it as Bob needs. The page hands him the live catalogue
// so the pointer he gives for anything outside his four is the real one.
export type BobTile = {
  /** What the package is called in full - the tile's two lines put back
   *  together, which is how a person would name it out loud. */
  code: string; name: string; availability: string; trade?: string | null;
};

export type Read =
  | { kind: "skill"; skill: Skill }
  // Something the catalogue covers that Bob is not good at yet. He says so.
  | { kind: "nearby"; tile: BobTile }
  | { kind: "unknown" };

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;

// Scoring, and it is deliberately dull: a phrase either appears or it does
// not, and a longer phrase beats a shorter one, so "no hot water" wins over
// the bare word "water". Nothing here guesses; if two skills tie, the one
// Shahar named first wins, which is the order they are declared in.
function score(text: string, phrases: string[]): number {
  const t = norm(text);
  let best = 0;
  for (const p of phrases) {
    if (t.includes(norm(p))) best = Math.max(best, p.length);
  }
  return best;
}

export function read(text: string, tiles: BobTile[] = []): Read {
  if (norm(text).trim().length < 2) return { kind: "unknown" };

  let top: { skill: Skill; n: number } | null = null;
  for (const skill of SKILLS) {
    const n = score(text, skill.phrases);
    if (n > 0 && (top === null || n > top.n)) top = { skill, n };
  }
  if (top) return { kind: "skill", skill: top.skill };

  // OUTSIDE HIS FOUR. Matched word by word against the tile's own name and
  // its trade, because "paint the living room" should still find the painting
  // package - it just must not come back sounding like something he knows.
  // A shared five-letter stem counts, so paint/painting and gutter/gutters are
  // the same word to him; four-letter words must match outright, because
  // "deck" and "decide" are not.
  const said = norm(text).trim().split(" ").filter((w) => w.length >= 4);
  let near: { tile: BobTile; n: number } | null = null;
  for (const tile of tiles) {
    if (SKILLS.some((s) => s.code === tile.code)) continue;
    for (const w of norm(`${tile.name} ${tile.trade ?? ""}`).trim().split(" ")) {
      if (w.length < 4) continue;
      const hit = said.some((q) => q === w
        || (q.length >= 5 && w.length >= 5 && (q.startsWith(w.slice(0, 5)) || w.startsWith(q.slice(0, 5)))));
      if (hit && (near === null || w.length > near.n)) near = { tile, n: w.length };
    }
  }
  return near ? { kind: "nearby", tile: near.tile } : { kind: "unknown" };
}
