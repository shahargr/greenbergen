import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { newActivity } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activities · Admin" };

// THE PROCESSES, AT THE TOP LEVEL (Shahar, 2026-09-18: "move this entire
// branch of activities under admin top level for faster access").
//
// A process is the step-by-step that makes a package real: the ten steps of
// the generator, in the order they actually happen. They used to be reachable
// only through the package that pointed at one - and only from the database,
// because the functions to edit them (migration 176) never had a screen. This
// is that screen, and it is its own branch because a process outlives the
// package it was written for: the same ten steps serve a booked generator, a
// homeowner reading before they decide, and the job we run ourselves.
type Row = {
  id: string; name: string; domain: string | null; description: string | null;
  is_active: boolean; steps: number; packages: string[] | null;
};

export default async function ActivitiesPage({
  searchParams,
}: { searchParams: Promise<{ error?: string; ok?: string }> }) {
  const { error, ok } = await searchParams;
  const supabase = await createClient();

  const [{ data: me }, { data }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("portal_processes"),
  ]);
  if (!me?.is_superadmin) redirect("/my");
  const rows = (data ?? []) as Row[];

  return (
    <main>
      <h1 style={{ fontSize: 24, margin: "0 0 4px" }}>Activities</h1>
      <p className="muted small" style={{ margin: "0 0 14px" }}>
        The step-by-step behind a package. Each step names the trade whose hand it needs — or us —
        and carries the explanation and photograph somebody follows on site.
      </p>

      {error && <p className="error" style={{ margin: "0 0 12px" }}>{error}</p>}
      {ok === "made" && <p className="small" style={{ margin: "0 0 12px" }}>Made. Add its steps.</p>}

      <div className="card" style={{ marginBottom: 14 }}>
        {rows.length === 0 && <p className="muted small" style={{ margin: 0 }}>No processes yet.</p>}
        {rows.length > 0 && (
          <table className="tasktable" style={{ width: "100%" }}>
            <thead>
              <tr><th>Process</th><th>Used by</th><th style={{ textAlign: "right" }}>Steps</th><th>Domain</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/admin/activities/${r.id}`} style={{ fontWeight: 600 }}>{r.name}</Link>
                    {!r.is_active && <span className="muted small"> · off</span>}
                    {r.description && <div className="muted small">{r.description}</div>}
                  </td>
                  <td className="muted small">
                    {r.packages && r.packages.length > 0 ? r.packages.join(", ") : "—"}
                  </td>
                  <td style={{ textAlign: "right" }}>{r.steps}</td>
                  <td className="muted small">{r.domain ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2 className="section-title">A new process</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Name it for the work, not for the trade — &ldquo;Standby generator, start to finish&rdquo; rather
          than &ldquo;Electrical&rdquo;. The steps say which trade does what.
        </p>
        <form action={newActivity} className="pk-row">
          <label className="pk-f wide"><span>Name</span>
            <input className="input" name="name" required placeholder="Standby generator, start to finish" /></label>
          <label className="pk-f wide"><span>What it is for</span>
            <input className="input" name="description" placeholder="One line" /></label>
          <div className="pk-acts"><button className="btn small">Make it</button></div>
        </form>
      </div>
    </main>
  );
}
