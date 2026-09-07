import { AppBar, Screen, StepKicker } from "@/components/ui";
import { TileSkeleton } from "@/components/PackageTile";

// Screen 4c - grid loading. Skeletons keep the shape; never a spinner.
export default function Loading() {
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <StepKicker>Step 1 of 3</StepKicker>
        <div className="hero">
          <h1>What would you like to get done?</h1>
          <p className="lead">Loading this week&apos;s packages…</p>
        </div>
        <div className="tiles">
          {Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} />)}
        </div>
      </div>
    </Screen>
  );
}
