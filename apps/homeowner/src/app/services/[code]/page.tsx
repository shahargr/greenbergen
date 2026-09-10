import { notFound } from "next/navigation";
import { getMe } from "@/lib/me";
import { COMMUNITY_SERVICES } from "@shared/catalogue";
import { dollars } from "@shared/format";
import { AppBar, Card, Screen } from "@shared/ui";
import { Illustration } from "@shared/Illustrations";
import { QuoteForm } from "@/app/packages/[code]/QuoteForm";

export const dynamic = "force-dynamic";

// Screen 4d - a community service: low-ticket, recurring, delivered by a
// neighbor on the route. One representative design establishes the pattern;
// signing up records interest as a task until the season opens.
export default async function ServicePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const s = COMMUNITY_SERVICES.find((x) => x.code === code);
  if (!s) notFound();
  // One read: whether they are signed in, and the homes the address list
  // is drawn from. isSignedIn on its own would have cost a second call for
  // the homes anyway.
  const me = await getMe();
  const homes = me.signed_in ? me.homes.map((h) => ({ project_id: h.project_id, address: h.address, name: h.name })) : [];
  return (
    <Screen>
      <AppBar back="/packages/more" />
      <div className="body">
        <span className="tag tag-accent" style={{ alignSelf: "flex-start" }}>Group purchase</span>
        <div className="illus"><Illustration name={s.illustration} /></div>
        <div className="hero">
          <h1>{s.name}</h1>
          <p className="lead">{s.description}</p>
        </div>
        <Card pad={false}>
          <div className="kv-rows" style={{ padding: "4px 14px" }}>
            <div><span className="k">{s.price_label}</span><strong>{dollars(s.price_cents)}</strong></div>
            <div><span className="k">Charged</span><span>{s.charged}</span></div>
            <div><span className="k">Season</span><span>{s.season}</span></div>
            <div><span className="k">Neighbors signed up on your street</span><span className="text-muted">Not yet counted</span></div>
          </div>
        </Card>
        <QuoteForm code={s.code} signedIn={me.signed_in} homes={homes} prompt="Anything we should know? (gate code, where to leave the bags)" cta="Sign up for the season" />
        <p className="small text-muted" style={{ margin: 0 }}>We&apos;ll ask for your address and a card when the season opens. Nothing is charged until a delivery lands.</p>
      </div>
    </Screen>
  );
}
