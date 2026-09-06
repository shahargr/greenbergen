import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { StartProjectForm } from "../StartProjectForm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Membership = {
  role: string;
  projects: {
    id: string; project_name: string; address: string | null; status: string;
    parent_project_id: string | null; is_template: boolean; asset_id: string | null;
    trashed_at: string | null; home_blueprint_code: string | null;
  } | null;
};

// A clean screen for starting a project - nothing above it but the way
// back. Properties (asset-backed, open) are the candidate parents,
// defaulting to the one with the latest task activity.
export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; parent?: string }>;
}) {
  const { error, parent: parentParam } = await searchParams;
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");

  const { data: rows } = me?.app_user_id
    ? await supabase
        .from("project_members")
        .select("role, projects(id, project_name, address, status, parent_project_id, is_template, asset_id, trashed_at, home_blueprint_code)")
        .eq("app_user_id", me.app_user_id)
        .eq("status", "active")
        .eq("role", "owner")
    : { data: [] };
  const owned = (((rows ?? []) as unknown as Membership[]))
    .filter((m) => m.projects && !m.projects.is_template && !m.projects.trashed_at)
    .map((m) => m.projects!)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);

  // Where a project may belong: a HOME (the usual), or a PROJECT already on
  // one, when the new work is a piece of it - the pergola under the
  // improvements. A closed home still takes new projects: that is where its
  // leftovers live (rulebook 60). Services are not parents.
  const byId = new Map(owned.map((p) => [p.id, p]));
  const isHouse = (p: NonNullable<Membership["projects"]>) =>
    !p.home_blueprint_code && !!p.address && (!p.parent_project_id || !byId.get(p.parent_project_id)?.address);
  const homes = owned.filter(isHouse);
  const jobs = owned.filter((p) => !p.home_blueprint_code && !isHouse(p) && p.status === "In Progress" && p.parent_project_id && byId.has(p.parent_project_id));
  // Homes first (open before closed), each followed by its own projects.
  const nameOfParent = (p: NonNullable<Membership["projects"]>) => byId.get(p.parent_project_id ?? "")?.project_name ?? "";
  const parentHomes = [
    ...homes.filter((h) => h.status === "In Progress"),
    ...homes.filter((h) => h.status !== "In Progress"),
  ].flatMap((h) => [
    { id: h.id, name: h.project_name, address: h.status === "In Progress" ? h.address : `${h.address ?? ""} · ${h.status}`.replace(/^ · /, ""), status: h.status },
    ...jobs.filter((j) => j.parent_project_id === h.id).map((j) => ({ id: j.id, name: `↳ ${j.project_name}`, address: `under ${nameOfParent(j)}`, status: j.status })),
  ]);

  if (parentHomes.length === 0) {
    return (
      <main className="wrap" style={{ paddingTop: 32, maxWidth: 560 }}>
        <p className="muted">Claim your address first — then projects live under it.</p>
        <p><Link href="/my">← Back home</Link></p>
      </main>
    );
  }

  let defaultParent = parentHomes[0].id;
  const { data: lastTouched } = await supabase
    .from("actions")
    .select("project_id")
    .in("project_id", homes.map((p) => p.id))
    .order("last_updated", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastTouched?.project_id && parentHomes.some((p) => p.id === lastTouched.project_id)) {
    defaultParent = lastTouched.project_id as string;
  }
  // Arriving from a property's hub: that home, no guessing.
  if (parentParam && parentHomes.some((p) => p.id === parentParam)) defaultParent = parentParam;

  return (
    <main className="wrap" style={{ paddingTop: 24, paddingBottom: 96, maxWidth: 560 }}>
      <p className="small" style={{ margin: "0 0 6px" }}><Link href="/my">← Home</Link></p>
      <h1 style={{ fontSize: 26, margin: "0 0 12px" }}>Start a project</h1>
      <div className="card">
        <StartProjectForm
          homes={parentHomes.map((p) => ({ id: p.id, name: p.name, address: p.address }))}
          defaultParent={defaultParent}
          error={error}
        />
      </div>
    </main>
  );
}
