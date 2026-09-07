import { notFound, redirect } from "next/navigation";
import { getBooking } from "@/lib/booking";
import { formsFor } from "@/lib/forms";
import { AppBar, Blueprint, Screen } from "@shared/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Permit forms" };

// Screen 13b - the form library, download only. The town's (state's) own
// PDFs; the contractor fills in what the job needs and brings them to the
// meeting - the homeowner just signs. Pre-filled forms are a later phase.
export default async function FormsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, missing } = await getBooking(id);
  if (missing) redirect("/project");
  if (!b) notFound();
  const forms = formsFor(b.package?.trade ?? null, b.package_code);
  const town = b.address?.split(",")[1]?.trim().replace(/\s+NJ.*$/, "") ?? "your town";
  const first = b.contractor?.person?.split(" ")[0] ?? "Your contractor";
  return (
    <Screen>
      <AppBar back={`/project/${id}/folder`} title="Permit forms" />
      <div className="body">
        <div>
          <div className="kicker">{town} · Building Dept.</div>
          <p className="small text-muted" style={{ margin: "4px 0 0" }}>New Jersey&apos;s own Uniform Construction Code PDFs. {first} fills in what your job needs and brings them to the meeting — you just sign.</p>
        </div>
        <Blueprint pad={false}>
          {forms.map((f) => (
            <a key={f.code} className="frow" href={f.url} target="_blank" rel="noopener noreferrer">
              <span className="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l4 4v14H7zM14 3v4h4" /></svg></span>
              <span className="grow"><div className="t">{f.title}</div><div className="m">{f.note} · PDF{f.pages ? ` · ${f.pages} pages` : ""}</div></span>
              <span className="btn btn-secondary btn-icon" aria-hidden><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 4v12m0 0-4-4m4 4 4-4M5 20h14" /></svg></span>
            </a>
          ))}
        </Blueprint>
        <p className="small text-muted" style={{ margin: 0 }}>Town-specific forms (zoning, soil movement) aren&apos;t in the library yet — {first} brings those. Pre-filled forms are coming later. For now, nothing to fill in here — bring ID to the meeting.</p>
      </div>
    </Screen>
  );
}
