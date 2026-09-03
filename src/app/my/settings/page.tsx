import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saveProfile } from "./actions";
import { createHome } from "../actions";
import { restoreProject, deleteProjectNow } from "../project/[id]/actions";
import { PhotoPick } from "@/components/PhotoPick";

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
          {contact?.avatar_path ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`${supabase.storage.from("public-media").getPublicUrl(contact.avatar_path).data.publicUrl}?v=${Date.now()}`}
              alt="" width={42} height={42}
              style={{ width: 42, height: 42, borderRadius: "50%", objectFit: "cover", flex: "none" }}
            />
          ) : (
            <span className="tile-icon" aria-hidden style={{ width: 42, height: 42 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-3.8 3.4-6.5 8-6.5s8 2.7 8 6.5" /></svg>
            </span>
          )}
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

        {/* People per house live on the house page (click a house above);
            per-project people on the project page. Not repeated here. */}

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
