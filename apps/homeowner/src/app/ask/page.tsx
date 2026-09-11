import { createClient } from "@shared/supabase/server";
import { isSignedIn } from "@shared/supabase/session";
import { AppBar, Card, Screen } from "@shared/ui";
import { VoiceAsk } from "@/components/VoiceAsk";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tell us what you would like to do" };

// The voice ask on its own page: where Google brings a visitor back with
// their recording waiting (?voice=1), and a place to link to directly.
export default async function AskPage({ searchParams }: { searchParams: Promise<{ voice?: string }> }) {
  const { voice } = await searchParams;
  const supabase = await createClient();
  const signedIn = await isSignedIn(supabase);
  return (
    <Screen>
      <AppBar back="/" title="Tell us" />
      <div className="body">
        <div className="hero">
          <h1>What would you like to do in the house?</h1>
          <p className="lead">Say it in a recording. A person listens and comes back to you with a clear next step.</p>
        </div>
        <Card pad>
          <VoiceAsk signedIn={signedIn} autoOpen={voice === "1"} resume={voice === "1"} />
        </Card>
      </div>
    </Screen>
  );
}
