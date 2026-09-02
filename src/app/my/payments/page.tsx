import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { LogPaymentForm } from "../LogPaymentForm";
import { PaymentsList } from "../PaymentsList";

export const dynamic = "force-dynamic";

type MemberPayRow = {
  project_id: string; role: string; contact_id: string | null;
  contacts: { name: string | null; person_name: string | null } | null;
};
type PayRow = {
  id: string; amount: number; paid_on: string | null; description: string | null; notes: string | null;
  paid_from_account: string | null; payment_method_id: string | null;
  payment_methods: { name: string } | null; projects: { project_name: string } | null;
};
type ProjectOverview = { id: string; last_activity: string };
type Membership = {
  role: string;
  projects: { id: string; project_name: string; is_template: boolean } | null;
};

// The payments window: log a payment up top, and the recent ledger below,
// each entry editable in place (receipts can arrive after the fact).
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const { error, ok } = await searchParams;
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
  const [{ data: methodRows }, { data: contractRows }, { data: memberPayRows }, { data: recentRows }, { data: overviewRows }] = await Promise.all([
    supabase.from("payment_methods").select("id, name").eq("is_active", true).order("display_order", { ascending: true, nullsFirst: false }),
    supabase.from("contracts").select("id, title, project_id").in("project_id", pmIds).order("title"),
    supabase
      .from("project_members")
      .select("project_id, role, contact_id, contacts(name, person_name)")
      .in("project_id", pmIds)
      .eq("status", "active")
      .not("contact_id", "is", null),
    supabase
      .from("transactions")
      .select("id, amount, paid_on, description, notes, paid_from_account, payment_method_id, payment_methods(name), projects(project_name)")
      .eq("direction", "out")
      .in("status", ["paid", "paid - receipt filed", "paid - pending confirmation", "settled"])
      .order("paid_on", { ascending: false, nullsFirst: false })
      .limit(15),
    supabase.rpc("portal_projects_overview"),
  ]);

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

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 640 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>Payments</h1>

      {ok && <p className="banner" style={{ background: "#2f6b4f" }}>{ok}</p>}
      {error && <p className="error small">{error}</p>}

      <div className="card" style={{ marginBottom: 16 }}>
        <h2 className="section-title">Log a payment</h2>
        <LogPaymentForm
          projects={payProjects}
          members={payMembers}
          contracts={payContracts}
          methods={methods}
          meName={me?.full_name ?? me?.email ?? ""}
        />
      </div>

      <h2 className="section-title">Recent payments</h2>
      <PaymentsList
        methods={methods}
        payments={recent.map((r) => ({
          id: r.id,
          amount: r.amount,
          paid_on: r.paid_on,
          description: r.description,
          notes: r.notes,
          paid_from_account: r.paid_from_account,
          payment_method_id: r.payment_method_id,
          method: r.payment_methods?.name ?? null,
          project: r.projects?.project_name ?? null,
        }))}
      />
    </main>
  );
}
