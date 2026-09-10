import { redirect } from "next/navigation";
import { landing, loadDoors, DOOR_URL } from "@/lib/doors";

export const dynamic = "force-dynamic";

// THE ROOT IS A DOOR, NOT A SECOND FRONT PAGE.
//
// Until 2026-09-10 this was its own landing - "One home at a time", the
// tally, the book of houses - and a signed-in person got it too, with a
// "Continue as Shahar" button in the middle. Shahar, seeing that screen
// first after signing in with Google: "this cannot be the first image
// one I sign in... something is off." He was right twice over. Two front
// doors had grown (this one and the homeowner app's, redone the same day
// with the same houses in it), and a signed-in person was being shown a
// sales page with a button to get past it.
//
// So the root decides and moves on:
//   signed out  -> the homeowner app's front door (/home): what we do, the
//                  houses, one way in. The one shop window.
//   signed in   -> the same door logic as every sign-in (/after-login,
//                  landing()): one door lands in its app, several ask at
//                  /choose. No interstitial.
// The book of houses and the tally live on in public_company(); the
// homeowner landing draws the showcase from it.
export default async function Root() {
  const doors = await loadDoors();
  redirect(doors.signed_in ? landing(doors) : DOOR_URL.homeowner);
}
