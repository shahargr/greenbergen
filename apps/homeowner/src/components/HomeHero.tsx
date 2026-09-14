import { Illustration } from "@shared/Illustrations";

// THE FIRST QUARTER OF EVERY HOME SCREEN.
//
// Shahar (2026-09-12): "Let's start with an image (25% of the screen,
// slightly faded, with a text on top stating: We get things done around your
// house)" - and then, when only the signed-in one got it: "it seems you are
// selectively fixing what i am asking for."
//
// He was right. There are TWO home screens - the front door a stranger lands
// on and the home screen a member lands on - and the change went onto one of
// them. So this is one component and both draw it: a screen redesign that
// lives in a single file cannot be applied to half the app.
//
// The photograph is data (config.landing_hero_url, migration 072). With none
// set it draws the house on the warm ground, so the page is whole either way.
export function HomeHero({ photo, line }: { photo: string | null; line: string }) {
  return (
    <div className={`home-hero ${photo ? "" : "drawn"}`}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="" fetchPriority="high" />
        : <Illustration name="house" />}
      <h1>{line}</h1>
    </div>
  );
}

// THE WORDING OF LAST RESORT. Shahar (2026-09-14): "where is this
// configured... if its hard coded, move it into the console with field i can
// update." It is config.landing_hero_line now (migration 121); this is what
// the page says if that is ever empty, so the hero is never wordless.
export const HOME_LINE = "We get things done around your house";

// Sentence case for the greeting form, without flattening a name or a place
// the way toLowerCase() would.
export const uncap = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
