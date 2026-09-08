import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { AppBar, Card, Screen } from "@shared/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

// Step 2 of the build order. The state is already read (contractor_me
// returns each document and whether it has lapsed), so this screen tells
// the truth about what is on file - it just cannot take an upload yet.
export default async function DocumentsPage() {
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/business/documents");
  const d = me.documents;
  const rows: { label: string; state: { needed: boolean; on_file: boolean }; note: string }[] = [
    { label: "Trade licence", state: d.licence, note: me.trades.find((t) => t.licence)?.licence ?? "Required for the trades you picked" },
    { label: "General liability", state: d.liability, note: "Certificate of insurance, in your business name" },
    { label: "Workers' compensation", state: d.workers_comp, note: "Or an exemption, if you work alone" },
    { label: "W-9", state: d.w9, note: "So the paperwork is done before the first payment, not after" },
  ];

  return (
    <Screen>
      <AppBar back="/business" title="Documents" />
      <div className="body">
        <div className="hero">
          <h1>What we need on file.</h1>
          <p className="lead">These are what let a neighbour trust a stranger in their basement. Nothing here is decoration.</p>
        </div>
        <section className="stack" style={{ gap: 8 }}>
          {rows.filter((r) => r.state.needed).map((r) => (
            <Card pad key={r.label} className="tight">
              <div className="between">
                <div className="grow">
                  <div className="card-title" style={{ fontSize: 15 }}>{r.label}</div>
                  <div className="small text-muted">{r.note}</div>
                </div>
                <span className={`tag ${r.state.on_file ? "tag-ok" : "tag-neutral"}`}>{r.state.on_file ? "On file" : "Missing"}</span>
              </div>
            </Card>
          ))}
        </section>
        {d.expiring.length > 0 && (
          <Card pad>
            <div className="card-title" style={{ fontSize: 15 }}>Expiring soon</div>
            {d.expiring.map((e, i) => <div className="small text-muted" key={i}>{e.coverage ?? "Certificate"} · {e.expires}</div>)}
          </Card>
        )}
        <Card soft pad>
          <div className="small">
            Uploading is the next thing we&apos;re building. For now, email them to us and we&apos;ll put them on
            file for you. <Link href="/business">Back to your business</Link>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
