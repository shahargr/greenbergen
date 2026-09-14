import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/me";
import { AppBar, Card, Notice, Screen } from "@shared/ui";
import { PaperUpload, type PaperKey } from "./PaperUpload";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents" };

// WHAT WE NEED ON FILE - and, since 2026-09-14, where you actually put it.
//
// The screen told the truth about each document and then asked people to
// email them in, so nothing ever moved. Every one of these now uploads to the
// credentials bucket and lands in what contractor_readiness reads, which is
// what makes the inbox message standing in for it close itself (migration
// 104). Shahar: "messages i cannot dismiss without uploading these papers" -
// this is the other half of that sentence.
export default async function DocumentsPage() {
  const me = await getMe();
  if (!me.signed_in) redirect("/login?next=/business/documents");
  const d = me.documents;
  const contactId = me.profile.contact_id;

  const rows: {
    key: PaperKey; label: string; state: { needed: boolean; on_file: boolean };
    note: string; wantsExpiry?: boolean; wantsNumber?: boolean;
  }[] = [
    { key: "licence", label: "Trade licence", state: d.licence, wantsNumber: true,
      note: me.trades.find((t) => t.licence)?.licence ?? "Required for the trades you picked" },
    { key: "liability", label: "General liability", state: d.liability, wantsExpiry: true,
      note: "Certificate of insurance, in your business name" },
    { key: "workers_comp", label: "Workers' compensation", state: d.workers_comp, wantsExpiry: true,
      note: "Or an exemption, if you work alone" },
    { key: "w9", label: "W-9", state: d.w9,
      note: "So the paperwork is done before the first payment, not after" },
  ];
  const wanted = rows.filter((r) => r.state.needed);
  const left = wanted.filter((r) => !r.state.on_file).length;

  return (
    <Screen>
      <AppBar back="/business" title="Documents" />
      <div className="body">
        <div className="hero">
          <h1>What we need on file.</h1>
          <p className="lead">
            {left === 0
              ? "Everything is here. Nothing is waiting on you."
              : `${left === 1 ? "One document is" : `${left} documents are`} still missing. These are what let a neighbour trust a stranger in their basement — nothing here is decoration.`}
          </p>
        </div>

        {!contactId && (
          <Notice kind="error" title="We couldn&apos;t read your account just now.">
            Uploading needs it. <Link href="/business/documents">Try again</Link>.
          </Notice>
        )}

        <section className="stack" style={{ gap: 8 }}>
          {wanted.map((r) => (
            <Card pad key={r.key} className="tight">
              <div className="between">
                <div className="grow">
                  <div className="card-title" style={{ fontSize: 15 }}>{r.label}</div>
                  <div className="small text-muted">{r.note}</div>
                </div>
                <span className={`tag ${r.state.on_file ? "tag-ok" : "tag-neutral"}`}>
                  {r.state.on_file ? "On file" : "Missing"}
                </span>
              </div>
              {!r.state.on_file && contactId && (
                <PaperUpload contactId={contactId} paper={r.key}
                  wantsExpiry={r.wantsExpiry} wantsNumber={r.wantsNumber} />
              )}
            </Card>
          ))}
        </section>

        {d.expiring.length > 0 && (
          <Card pad>
            <div className="card-title" style={{ fontSize: 15 }}>Expiring soon</div>
            {d.expiring.map((e, i) => (
              <div className="small text-muted" key={i}>{e.coverage ?? "Certificate"} · {e.expires}</div>
            ))}
            <p className="tiny text-muted" style={{ margin: "6px 0 0" }}>
              A certificate that has run out is not on file. Upload the new one above and it takes over.
            </p>
          </Card>
        )}

        <Card soft pad>
          <div className="small">
            Your documents are yours: only Green Bergen and the people you are on a job with can see them.
            <br /><Link href="/business">Back to your business</Link>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
