import Link from "next/link";
import { VoiceAsk } from "@/components/VoiceAsk";
import { withBase } from "@shared/site";

// ASK BOB, AT THE TOP, AS A SEARCH SCREEN (Shahar, 2026-09-19).
//
// "This page should lead with Ask Bob, like a search screen with audio /
// video recording option. In a background of knowledge handyman."
//
// WHY THIS IS THE RIGHT TOP. A member arrives with a SITUATION - the power
// keeps going out, there is no hot water - and the screen used to open with a
// shelf that asks them to already know the name of the answer. A search box
// takes the sentence they already have in their head.
//
// THREE WAYS IN, ONE ERRAND. Type it, say it, or show it. They are not three
// features: they are the same question asked by somebody standing in a
// basement with one hand on a torch, and which hand is free decides which one
// they use.
//
// NOT A CLIENT COMPONENT. The box is a plain GET form to /ask - it works with
// no JavaScript, it is prefetchable, and the answer page is where Bob does
// his reading. Only the two recorders are client, and only because a
// microphone and a camera are.
export function BobSearch({ photo, signedIn }: { photo: string | null; signedIn: boolean }) {
  return (
    <section className={`bob-hero${photo ? "" : " drawn"}`}>
      {/* The photograph is data (config.bob_hero_url, migration 193). With
          none set the band draws its own ground and reads exactly as well -
          Bob is the box, not the picture. */}
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="bob-bg" src={photo} alt="" fetchPriority="high" />
      )}
      <div className="bob-inner">
        <p className="bob-eyebrow">Ask Bob</p>
        <h1 className="bob-line">What is going on in the house?</h1>

        {/* withBase, and it is not optional: this is a NATIVE form, and a
            native form is a raw URL. next/link, redirect() and router.push()
            add the /home prefix themselves; an action= attribute does not, so
            this posted to the PORTAL's /ask - which does not exist - and
            every question typed here answered with a 404 (Shahar,
            2026-09-19: "i types in the ask bob window 'My fauset leaks' and
            got a 404 page"). The one plain form in the app was the one place
            the basePath had to be written by hand. */}
        <form className="bob-box" action={withBase("/ask")} method="get">
          <input className="bob-q" type="search" name="q" autoComplete="off"
            aria-label="Tell Bob what is going on"
            placeholder="“the power keeps going out”" />
          <div className="bob-ways">
            <VoiceAsk signedIn={signedIn} trigger="icon" />
            <VoiceAsk signedIn={signedIn} trigger="icon" mode="clip" />
            <button className="bob-go" type="submit" aria-label="Ask Bob">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" />
              </svg>
            </button>
          </div>
        </form>

        <p className="bob-sub">
          Type it, say it, or show it. Today Bob is good at generators, water heaters, EV chargers and home
          internet — and he says so plainly when something is not his.{" "}
          <Link href="/ask">What he knows</Link>
        </p>
      </div>
    </section>
  );
}
