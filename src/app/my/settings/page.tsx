import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saveProfile } from "./actions";
import { createHome } from "../actions";
import { restoreProject, deleteProjectNow } from "../project/[id]/actions";
import { PhotoPick } from "@/components/PhotoPick";
import { cookies } from "next/headers";
import { setGodMode } from "../../admin/actions";

type HomeAsset = {
  projectId: string;
  projectName: string;
  address: string | null;
  assetId: string;
  askingPrice: number | null;
};

// Account settings: who you are, your home's direct-sale listing, and the
// sections still to come (images, assets & warranties, your contractors).
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string; verified?: string }>;
}) {
  const { saved, error, verified } = await searchParams;
  const supabase = await createClient();
  const [{ data: me }, { data: trashData }, { data: contactsData }] = await Promise.all([
    supabase.rpc("me"),
    supabase.rpc("my_trash"),
    supabase.rpc("portal_my_contacts"),
  ]);
  // Every house / project you own or manage, with its approved people.
  type ContactPerson = { contact_id: string; name: string; phone: string | null; email: string | null; notes: string | null; role: string; trade: string | null };
  type ContactHouse = { project_id: string; project_name: string; address: string | null; people: ContactPerson[] };
  const contactHouses = ((contactsData ?? []) as ContactHouse[]);
  // Everyone ever added to one of my projects, at any role.
  type MyContractor = { id: string; name: string; company: string | null; trade: string | null; phone: string | null; email: string | null; seats: string[] | null; projects: number; awarded: number; vendor_status: string | null };
  const { data: contractorsData } = await supabase.rpc("portal_my_contractors");
  const contractors = ((contractorsData ?? []) as MyContractor[]);
  // God mode (superadmins): the same cookie the Admin overview toggles.
  const godOn = !!me?.is_superadmin && (await cookies()).get("gb_god")?.value === "1";

  // Every seat the caller holds (any role): houses (roots) with their projects.
  type MemProj = { id: string; project_name: string; address: string | null; status: string; parent_project_id: string | null; is_template: boolean; trashed_at: string | null };
  const { data: memRows } = me?.app_user_id
    ? await supabase
        .from("project_members")
        .select("role, project_role, projects(id, project_name, address, status, parent_project_id, is_template, trashed_at)")
        .eq("app_user_id", me.app_user_id)
        .eq("status", "active")
    : { data: [] };
  const seats = new Map<string, Set<string>>();
  const memProjects = new Map<string, MemProj>();
  for (const r of ((memRows ?? []) as unknown as { role: string; project_role: string | null; projects: MemProj | null }[])) {
    const p = r.projects;
    if (!p || p.is_template || p.trashed_at) continue;
    memProjects.set(p.id, p);
    const s = seats.get(p.id) ?? new Set<string>();
    s.add(r.project_role ?? r.role);
    seats.set(p.id, s);
  }
  const houses = [...memProjects.values()]
    .filter((p) => !p.parent_project_id || !memProjects.has(p.parent_project_id))
    .sort((a, b) => a.project_name.localeCompare(b.project_name));
  const childrenOf = (pid: string) =>
    [...memProjects.values()].filter((p) => p.parent_project_id === pid).sort((a, b) => a.project_name.localeCompare(b.project_name));
  const trashDays: number = trashData?.days ?? 14;
  const trashItems = ((trashData?.items ?? []) as { id: string; name: string; trashed_at: string; expires_on: string }[]);

  const { data: contact } = me?.contact_id
    ? await supabase
        .from("contacts")
        .select("phone, address, avatar_path")
        .eq("id", me.contact_id)
        .maybeSingle()
    : { data: null };

  const { data: homeProjects } = await supabase
    .from("projects")
    .select("id, project_name, address, asset_id")
    .not("asset_id", "is", null)
    .is("parent_project_id", null)
    .is("trashed_at", null)
    .eq("owner_user_id", me?.app_user_id ?? "00000000-0000-0000-0000-000000000000");

  const assetIds = (homeProjects ?? []).map((p) => p.asset_id as string);
  const { data: assets } = assetIds.length
    ? await supabase.from("assets").select("id, asking_price").in("id", assetIds)
    : { data: [] };

  const homes: HomeAsset[] = (homeProjects ?? []).map((p) => ({
    projectId: p.id as string,
    projectName: p.project_name as string,
    address: (p.address as string) ?? null,
    assetId: p.asset_id as string,
    askingPrice:
      ((assets ?? []).find((a) => a.id === p.asset_id)?.asking_price as number | null) ?? null,
  }));

  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96, maxWidth: 640 }}>
      <span className="kicker">Settings</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 14px" }}>Your account</h1>

      {saved && (
        <p className="banner" style={{ background: "#2f6b4f" }}>
          Saved ✓
          {verified === "1" && " — address verified and standardized"}
          {verified === "0" && " — we couldn't verify that address, saved as typed"}
        </p>
      )}
      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        <div className="card" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {/* No images on this page: the photo shows on task panels only. */}
          <span>
            <strong style={{ fontSize: 16 }}>{me?.full_name ?? "Unnamed"}</strong>
            <div className="muted small">
              Signed in as <strong>{me?.email}</strong>
              {me?.is_superadmin && <span className="extra-chip" style={{ marginLeft: 8 }}>admin</span>}
            </div>
            <div className="muted small">
              {contact?.phone ? <a href={`tel:${contact.phone}`} style={{ textDecoration: "none" }}>📞 {contact.phone}</a> : <span>📞 no phone yet</span>}
            </div>
          </span>
        </div>

        {/* Superadmin controls, right where the account is. */}
        {me?.is_superadmin && (
          <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderLeft: godOn ? "4px solid #7a1f2b" : undefined }}>
            <span>
              <strong>⚡ God mode · {godOn ? "ON" : "off"}</strong>
              <div className="muted small">ON: every project on the platform, full admin rights, red banner on each page. OFF: only projects you hold a seat on.</div>
            </span>
            <span className="btn-row" style={{ gap: 8 }}>
              <form action={setGodMode}>
                <input type="hidden" name="back" value="/my/settings" />
                <input type="hidden" name="on" value={godOn ? "0" : "1"} />
                <button className="btn small" style={godOn ? undefined : { background: "#7a1f2b" }}>{godOn ? "Turn off" : "Turn on"}</button>
              </form>
              <Link href="/admin" className="btn ghost small">Admin console →</Link>
            </span>
          </div>
        )}

        {/* The identity card above is the summary; the full form sits behind Edit. */}
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>✏️ Edit your details</summary>
          <form action={saveProfile} style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="st-name">Full name</label>
              <input id="st-name" name="full_name" className="input" defaultValue={me?.full_name ?? ""} />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="st-phone">Phone</label>
              <input id="st-phone" name="phone" className="input" type="tel" defaultValue={contact?.phone ?? ""} />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Profile photo (optional)</label>
            <PhotoPick name="avatar" label="Add photo" />
            <p className="muted small" style={{ margin: "4px 0 0" }}>
              Shows on your task panels. Leave empty to keep {contact?.avatar_path ? "your current photo" : "the icon"}.
            </p>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="st-address">Home address</label>
            <input id="st-address" name="address" className="input"
              defaultValue={contact?.address ?? homes[0]?.address ?? ""} />
            {!contact?.address && homes[0]?.address && (
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                Pre-filled from your claimed home — hit Save to keep it.
              </p>
            )}
          </div>
          <div>
            <button className="btn">Save</button>
          </div>
          </form>
        </details>

        {/* Your houses & projects: every seat you hold. A house opens its own page. */}
        <div className="card" style={{ display: "grid", gap: 6 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your houses &amp; projects · {memProjects.size}</h2>
          {houses.length === 0 && <p className="muted small" style={{ margin: 0 }}>You don&apos;t hold a seat on any project yet.</p>}
          {houses.map((h) => (
            <div key={h.id} style={{ display: "grid", gap: 3, borderTop: "1px solid #eef0ec", paddingTop: 6 }}>
              <div className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <Link href={`/my/house/${h.id}`} style={{ fontWeight: 700 }}>🏠 {h.project_name} →</Link>
                <span className="muted" style={{ whiteSpace: "nowrap" }}>{[...(seats.get(h.id) ?? [])].join(", ")} · {h.status}</span>
              </div>
              {h.address && <div className="muted small">{h.address}</div>}
              {childrenOf(h.id).map((p) => (
                <div key={p.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, paddingLeft: 18 }}>
                  <Link href={`/my/project/${p.id}`}>↳ {p.project_name}</Link>
                  <span className="muted" style={{ whiteSpace: "nowrap" }}>{[...(seats.get(p.id) ?? [])].join(", ")} · {p.status}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Your contractors: anyone ever added to a project of yours, at any
            role. Each row opens the person's page. */}
        <div className="card" style={{ display: "grid", gap: 6, overflowX: "auto" }}>
          <h2 className="section-title" style={{ margin: 0 }}>Your contractors · {contractors.length}</h2>
          {contractors.length === 0 && <p className="muted small" style={{ margin: 0 }}>No one added to your projects yet.</p>}
          {contractors.length > 0 && (
            <table className="tasktable" style={{ width: "100%" }}>
              <thead><tr><th>Trade</th><th>Name</th><th>Role</th><th style={{ textAlign: "right" }}>Projects</th><th>Phone</th><th>Email</th></tr></thead>
              <tbody>
                {contractors.map((c) => (
                  <tr key={c.id}>
                    <td className="muted" style={{ whiteSpace: "nowrap" }}>{c.trade ?? "—"}</td>
                    <td>
                      <Link href={`/my/contractor/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>
                      {c.company && c.company !== c.name && <div className="muted small">{c.company}</div>}
                    </td>
                    <td className="small">{c.seats?.length ? c.seats.join(", ") : <span className="muted">—</span>}</td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{c.projects}{c.awarded > 0 && <span className="muted small"> · {c.awarded} awarded</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{c.phone ? <a href={`tel:${c.phone}`}>{c.phone}</a> : <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{c.email ? <a href={`mailto:${c.email}`}>{c.email}</a> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <details className="card">
          <summary className="section-title" style={{ cursor: "pointer", marginBottom: 0 }}>
            Claim another address
          </summary>
          <p className="muted small" style={{ margin: "10px 0 8px" }}>
            Another property you own gets its own home page, projects and paperwork.
          </p>
          <form action={createHome} style={{ display: "grid", gap: 8, maxWidth: 380 }}>
            <input name="name" className="input" required autoComplete="off" placeholder="What should we call it?" />
            <input name="address" className="input" required placeholder="Address — 12 Maple Ave, Tenafly NJ" />
            <div><button className="btn">Claim it</button></div>
          </form>
        </details>

        {trashItems.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <h2 className="section-title">Recycle bin · {trashItems.length}</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Deleted projects stay restorable for {trashDays} days, then purge automatically.
            </p>
            {trashItems.map((t) => (
              <div key={t.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  <strong>{t.name}</strong>
                  <span className="muted"> · purges {t.expires_on}</span>
                </span>
                <span className="btn-row" style={{ gap: 6 }}>
                  <form action={restoreProject.bind(null, t.id)}>
                    <button className="btn ghost small">Restore</button>
                  </form>
                  <form action={deleteProjectNow.bind(null, t.id)}>
                    <button className="btn ghost small" style={{ color: "#c0262d", borderColor: "#e3b7ba" }}>Empty now</button>
                  </form>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <h2 className="section-title">Images</h2>
          <p className="muted small" style={{ margin: 0 }}>
            To be developed — photos of your home and its projects.
          </p>
        </div>
        <div className="card">
          <h2 className="section-title">Assets &amp; warranties</h2>
          <p className="muted small" style={{ margin: 0 }}>
            To be developed — every appliance and system in your home, with its
            warranty, serial number and paperwork in one place.
          </p>
        </div>
        <div className="card">
          <h2 className="section-title">Your contractors</h2>
          <p className="muted small" style={{ margin: 0 }}>
            To be developed — the people who work on your home, their trades
            and how to reach them.
          </p>
        </div>
      </div>
    </main>
  );
}
