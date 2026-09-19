import { LoadingScreen } from "@shared/LoadingScreen";

// EVERY SCREEN IN THIS APP, unless one draws its own shape below (the
// packages grid and a project do). A loading.tsx at the root is what makes a
// tap land instantly: Next swaps this in the moment you navigate and streams
// the real page in over it.
export default function Loading() {
  return <LoadingScreen />;
}
