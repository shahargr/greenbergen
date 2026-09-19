import { LoadingScreen } from "@shared/LoadingScreen";

// EVERY SCREEN IN PROFESSIONALS. The project, the bid room and the trade
// screens are the slow ones - several reads each - and they were the ones
// with no loading state at all, so a tap on a project did nothing visible
// for a second and a half.
export default function Loading() {
  return <LoadingScreen />;
}
