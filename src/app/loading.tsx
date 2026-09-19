import { LoadingScreen } from "@/components/LoadingScreen";

// EVERY SCREEN IN THE PORTAL, unless a route draws its own shape. /my is the
// one with maxDuration = 60 on it - the screen most worth not leaving blank.
export default function Loading() {
  return <LoadingScreen />;
}
