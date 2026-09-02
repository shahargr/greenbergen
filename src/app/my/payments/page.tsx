import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogPaymentForm } from "../LogPaymentForm";
import { PaymentsList } from "../PaymentsList";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type MemberPayRow = {
  project_id: string; role: string; contact_id: string | null;
  contacts: { name: string | null; person_name: string | null } | null;
};
type PayRow = {
  id: string; amount: number; paid_on: string | null; status: string; description: string | null; notes: string | null;
  paid_from_account: string | null; payment_method_id: string | null;
  payment_methods: { name: string } | null; projects: { project_name: string } | null;
};
type ProjectOverview = { id: string; last_activity: string };
type CompanyMemberRow = { project_id: string; companies: { company_name: string | null } | null };
type PayFileRow = { id: string; bucket: string; path: string; file_name: string; mime_type: string | null; kind: string | null; caption: string | null };
type Membership = {
  role: string;
  projects: { id: string; project_name: string; is_template: boolean } | null;
};

// The payments window: log a payment up top, and the recent ledger below,
// each entry editable in place (receipts can arrive after the fact).
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string; q?: string; all?: string }>;
}) {
  const { error, ok, q, all } = await searchParams;
  const showAll = all === "1";
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  const { data: membershipRows } = me?.app_user_id
    ? await supabase
        .from("project_members")
        .select("role, projects(id, project_name, is_template)")
        .eq("app_user_id", me.app_user_id)
        .eq("status", "active")
        .in("role", ["owner", "manager"])
    : { data: [] };
  const pmProjects = (((membershipRows ?? []) as unknown as Membership[]))
    .filter((m) => m.projects && !m.projects.is_template)
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);

  if (pmProjects.length === 0) {
    return (
      <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}>
        <p className="muted">Payments are for project managers and above.</p>
        <p><Link href="/my">← Back home</Link></p>
      </main>
    );
  }

  const pmIds = pmProjects.map((p) => p.id);
  const [{ data: methodRows }, { data: contractRows }, { data: memberPayRows }, { data: recentRows }, { data: overviewRows }, { data: companyRows }] = await Promise.all([
    supabase.from("payment_methods").select("id, name").eq("is_active", true).order("display_order", { ascending: true, nullsFirst: false }),
    supabase.from("contracts").select("id, title, project_id").in("project_id", pmIds).order("title"),
    supabase
      .from("project_members")
      .select("project_id, role, contact_id, contacts(name, person_name)")
      .in("project_id", pmIds)
      .eq("status", "active")
      .not("contact_id", "is", null),
    (() => {
      let qy = supabase
        .from("transactions")
        .select("id, amount, paid_on, status, description, notes, paid_from_account, payment_method_id, payment_methods(name), projects(project_name)")
        .eq("direction", "out");
      if (q) qy = qy.or(`description.ilike.%${q}%,notes.ilike.%${q}%,paid_from_account.ilike.%${q}%`);
      return qy.order("paid_on", { ascending: false, nullsFirst: false }).limit(q || showAll ? 100 : 5);
    })(),
    supabase.rpc("portal_projects_overview"),
    supabase
      .from("project_members")
      .select("project_id, companies(company_name)")
      .in("project_id", pmIds)
      .eq("status", "active")
      .not("company_id", "is", null),
  ]);

  const PAID_SET = ["paid", "paid - receipt filed", "paid - pending confirmation", "settled"];
  const [{ data: paidAgg }, { data: openAgg }, { data: statusRows }] = await Promise.all([
    supabase.from("transactions").select("amount").eq("direction", "out").in("status", PAID_SET),
    supabase.from("transactions").select("amount").eq("direction", "out")
      .in("status", ["forecast", "scheduled", "invoice received", "approved", "disputed"]),
    supabase.from("transaction_statuses").select("status"),
  ]);
  const paidRows2 = (paidAgg ?? []) as { amount: number | null }[];
  const openRows2 = (openAgg ?? []) as { amount: number | null }[];
  const paidTotal = paidRows2.reduce((t, r) => t + Number(r.amount ?? 0), 0);
  const openTotal = openRows2.reduce((t, r) => t + Number(r.amount ?? 0), 0);
  const statuses = ((statusRows ?? []) as { status: string }[]).map((r) => r.status);

  const methods = ((methodRows ?? []) as { id: string; name: string }[]);
  const preferred = ["Cash", "Check", "ACH", "Credit card"];
  methods.sort((a, b) =>
    (preferred.includes(a.name) ? preferred.indexOf(a.name) : 99) -
    (preferred.includes(b.name) ? preferred.indexOf(b.name) : 99));

  const activityRank = new Map(((overviewRows ?? []) as ProjectOverview[]).map((p, i) => [p.id, i]));
  const payProjects = [...pmProjects]
    .sort((a, b) => (activityRank.get(a.id) ?? 999) - (activityRank.get(b.id) ?? 999))
    .map((p) => ({ id: p.id, name: p.project_name }));

  const payMembers = (((memberPayRows ?? []) as unknown as MemberPayRow[]))
    .filter((m) => m.contact_id && m.contacts)
    .map((m) => ({
      projectId: m.project_id,
      contactId: m.contact_id as string,
      name: m.contacts!.person_name ?? m.contacts!.name ?? "Unnamed",
      canPay: m.role === "owner" || m.role === "manager",
    }))
    .filter((m, i, arr) => arr.findIndex((x) => x.projectId === m.projectId && x.contactId === m.contactId) === i);

  const payContracts = (((contractRows ?? []) as { id: string; title: string; project_id: string }[]))
    .map((c) => ({ id: c.id, title: c.title, projectId: c.project_id }));
  const recent = ((recentRows ?? []) as unknown as PayRow[]);

  // Attachments are keyed by transaction id in their storage path:
  // <project>/payments/<txId>/<file>. Signed so they render inline.
  const { data: payFileRows } = await supabase
    .from("files")
    .select("id, bucket, path, file_name, mime_type, kind, caption")
    .in("project_id", pmIds)
    .like("path", "%/payments/%")
    .order("created_at", { ascending: false })
    .limit(120);
  const attachmentsByTx = new Map<string, { url: string; kind: string; name: string }[]>();
  // Legacy receipts (uploaded before paths carried the transaction id)
  // match by caption: either "Receipt for: <description>" or the
  // "Payment: $X to <payee>" caption against the description's payee.
  const legacyTxFor = (caption: string | null): string | null => {
    if (!caption) return null;
    for (const r of recent) {
      const desc = r.description ?? "";
      if (desc && caption.endsWith(desc)) return r.id;
      const payee = desc.replace(/^Payment to /, "").split(" — ")[0];
      if (payee && caption.includes(` to ${payee} (`)) return r.id;
    }
    return null;
  };
  await Promise.all(
    (((payFileRows ?? []) as PayFileRow[])).map(async (f) => {
      const m = f.path.match(/\/payments\/([0-9a-f-]{36})\//);
      const txId = m ? m[1] : legacyTxFor(f.caption);
      if (!txId) return;
      const { data } = await supabase.storage.from(f.bucket).createSignedUrl(f.path, 3600);
      if (!data?.signedUrl) return;
      const kind = f.kind === "photo" || (f.mime_type ?? "").startsWith("image/") ? "photo"
        : f.kind === "video" || (f.mime_type ?? "").startsWith("video/") ? "video" : "audio";
      const list = attachmentsByTx.get(txId) ?? [];
      list.push({ url: data.signedUrl, kind, name: f.file_name });
      attachmentsByTx.set(txId, list);
    })
  );
  const payPayees = [
    ...payMembers.map((m) => ({ projectId: m.projectId, name: m.name })),
    ...(((companyRows ?? []) as unknown as CompanyMemberRow[]))
      .filter((c) => c.companies?.company_name)
      .map((c) => ({ projectId: c.project_id, name: c.companies!.company_name as string })),
  ];

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 640 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>Payments</h1>

      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {error && <p className="error small">{error}</p>}

      <div className="youband" style={{ marginBottom: 14 }}>
        <div className="tile" style={{ cursor: "default" }}>
          <span className="tile-label">Logged</span>
          <span style={{ fontSize: 20, fontWeight: 800 }}>${Math.round(paidTotal).toLocaleString()}</span>
          <span className="tile-sub">{paidRows2.length} payment{paidRows2.length === 1 ? "" : "s"} paid</span>
        </div>
        <div className="tile" style={{ cursor: "default" }}>
          <span className="tile-label">Outstanding</span>
          <span style={{ fontSize: 20, fontWeight: 800, color: "#a8842c" }}>${Math.round(openTotal).toLocaleString()}</span>
          <span className="tile-sub">{openRows2.length} awaiting payment</span>
        </div>
        <Link className="tile" href="/my/financials">
          <span className="tile-label">Financials</span>
          <span className="tile-sub" style={{ marginTop: 6 }}>Contracted vs. paid, per project</span>
        </Link>
      </div>

      <details className="card" style={{ marginBottom: 14 }} open={!!error}>
        <summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ Log a payment</summary>
        <div style={{ marginTop: 12 }}>
          <LogPaymentForm
            projects={payProjects}
            members={payMembers}
            contracts={payContracts}
            methods={methods}
            payees={payPayees}
            meName={me?.full_name ?? me?.email ?? ""}
          />
        </div>
      </details>

      <form action="/my/payments" method="get" className="btn-row" style={{ marginBottom: 12 }}>
        <input name="q" className="input" defaultValue={q ?? ""} placeholder="Search payments — payee, notes, account"
          style={{ maxWidth: 320 }} />
        <button className="btn ghost">Search</button>
        {(q || showAll) && <Link className="btn ghost" href="/my/payments">Clear</Link>}
      </form>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 className="section-title">
          {q ? `Matches for "${q}"` : showAll ? "All transactions" : "Last 5 transactions"}
        </h2>
        {!q && !showAll && <Link className="small" href="/my/payments?all=1">View all →</Link>}
      </div>
      <PaymentsList
        methods={methods}
        statuses={statuses}
        payments={recent.map((r) => ({
          id: r.id,
          amount: r.amount,
          paid_on: r.paid_on,
          status: r.status,
          description: r.description,
          notes: r.notes,
          paid_from_account: r.paid_from_account,
          payment_method_id: r.payment_method_id,
          method: r.payment_methods?.name ?? null,
          project: r.projects?.project_name ?? null,
          attachments: attachmentsByTx.get(r.id) ?? [],
        }))}
      />
    </main>
  );
}
