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
export function HomeHero({ photo, line }: { photo: string | null; line?: string | null }) {
  const words = line?.trim() || null;
  return (
    // BARE: a photograph with nothing written on it. The dark wash exists so
    // white type stays legible over a bright sky; with no type it is only
    // dimming somebody's photograph, so it comes off.
    <div className={`home-hero ${photo ? "" : "drawn"} ${words ? "" : "bare"}`}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="" fetchPriority="high" />
        : <Illustration name="house" />}
      {words && <h1>{words}</h1>}
    </div>
  );
}

// THERE IS NO CONSTANT ANY MORE. It was HOME_LINE here; it is
// config.landing_hero_line now (migration 121), and an empty field means NO
// LINE rather than falling back to wording nobody chose.
//
// Shahar (2026-09-14) cleared the field and the sentence was still there:
// "still shows as home owner". Of course it was - I had made empty mean "the
// app's own words come back", which is the one thing it cannot mean on a
// photograph that already carries its own headline. His does: the banner says
// Home Projects Made Easy and has its own button drawn into it, and we were
// writing a second headline across the middle of it.

// Sentence case for the greeting form, without flattening a name or a place
// the way toLowerCase() would.
export const uncap = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
