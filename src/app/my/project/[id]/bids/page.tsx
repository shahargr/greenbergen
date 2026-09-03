import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createPackage } from "./actions";

export const dynamic = "force-dynamic";

type Pkg = {
  id: string; phase: string | null; category: string | null; trade: string | null; status: string;
  reply_by: string | null; budget_visible: boolean; budget_amount: number | null;
  n_invited: number; n_received: number; awarded_bid_id: string | null;
};
type BudgetLine = { id: string; phase: string | null; category: string | null; target_amount: number | null };

const money = (n: number | null) => (n == null ? "—" : `$${Math.round(n).toLocaleString()}`);
const statusTone = (s: string) =>
  s === "open" ? { background: "#e4f0e9", color: "#2f6b4f" }
  : s === "reviewing" ? { background: "#f7efdd", color: "#a8842c" }
  : s === "awarded" ? { background: "#e4f0e9", color: "#2f6b4f" }
  : { background: "#eef1ea", color: "#7b857e" };

// Bid planner for one project: every package by phase, and a way to start
// one from a budget line (the line gives phase, category and the private target).
export default async function BidsPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const [{ data: project }, { data: pkgData }, { data: lineRows }, { data: rankData }] = await Promise.all([
    supabase.from("projects").select("id, project_name").eq("id", id).maybeSingle(),
    supabase.rpc("portal_bid_packages", { p_project: id }),
    supabase.from("budget_categories").select("id, phase, category, target_amount").eq("project_id", id).order("phase").order("category"),
    supabase.rpc("bid_can_manage", { p_project: id }),
  ]);
  if (!project) {
    return <main className="wrap" style={{ paddingTop: 32, maxWidth: 640 }}><p className="muted">This project is not yours to see.</p></main>;
  }
  const pkgs = ((pkgData ?? []) as Pkg[]);
  const lines = ((lineRows ?? []) as BudgetLine[]);
  const canManage = rankData === true;
  const phases = [...new Set(lines.map((l) => l.phase ?? "Other"))];

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 760 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href={`/my/project/${id}`}>← {project.project_name}</Link></p>
      <span className="kicker">Bid planner</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 12px" }}>Packages · {pkgs.length}</h1>
      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Saved ✓</p>}
      {error && <p className="error small">{error}</p>}
      <p className="muted small" style={{ margin: "0 0 14px" }}>
        One package per phase and category: scope, documents, optional budget, insurance and payment terms — so every reply lands in the same shape and can be compared like for like.
      </p>

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ overflowX: "auto" }}>
          {pkgs.length === 0 && <p className="muted small" style={{ margin: 0 }}>No packages yet — start one from a budget line below.</p>}
          {pkgs.length > 0 && (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead>
                <tr><th>Phase</th><th>Category</th><th>Status</th><th style={{ textAlign: "right" }}>Replies</th><th>Reply by</th><th>Budget</th></tr>
              </thead>
              <tbody>
                {pkgs.map((p) => (
                  <tr key={p.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.phase ?? "—"}</td>
                    <td><Link href={`/my/project/${id}/bids/${p.id}`} style={{ fontWeight: 600 }}>{p.category ?? p.trade ?? "Package"}</Link>
                      {p.trade && p.trade !== p.category && <span className="muted small"> · {p.trade}</span>}</td>
                    <td><span className="extra-chip" style={statusTone(p.status)}>{p.status}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{p.n_received} / {p.n_invited}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.reply_by ?? "—"}</td>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{p.budget_amount == null ? "hidden" : money(p.budget_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {canManage && (
          <details className="card" open={pkgs.length === 0}>
            <summary style={{ cursor: "pointer", fontWeight: 700 }}>＋ New package from a budget line</summary>
            <form action={createPackage.bind(null, id)} style={{ display: "grid", gap: 10, marginTop: 10, maxWidth: 480 }}>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="bp-line">Budget line (phase · category)</label>
                <select id="bp-line" name="budget_category" className="input" required defaultValue="">
                  <option value="" disabled>Pick a line…</option>
                  {phases.map((ph) => (
                    <optgroup key={ph} label={ph}>
                      {lines.filter((l) => (l.phase ?? "Other") === ph).map((l) => (
                        <option key={l.id} value={l.id}>{l.category} · {money(l.target_amount)}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
                {lines.length === 0 && <p className="muted small" style={{ margin: "4px 0 0" }}>No budget lines on this project yet.</p>}
              </div>
              <div className="field" style={{ marginBottom: 0 }}>
                <label htmlFor="bp-trade">Trade (optional — pre-fills scope lines for this trade)</label>
                <input id="bp-trade" name="trade" className="input" placeholder="e.g. Plumbing" autoComplete="off" />
              </div>
              <div><button className="btn">Create package</button></div>
            </form>
          </details>
        )}
      </div>
    </main>
  );
}
