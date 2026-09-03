import { createClient } from "@/lib/supabase/server";
import { saveProfile, saveAskingPrice, renameHome } from "./actions";
import { createHome } from "../actions";
import { restoreProject, deleteProjectNow, updateContact } from "../project/[id]/actions";

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
              src={supabase.storage.from("public-media").getPublicUrl(contact.avatar_path).data.publicUrl}
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
          </span>
        </div>

        <form action={saveProfile} className="card" style={{ display: "grid", gap: 10 }}>
          <h2 className="section-title">About you</h2>
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
            <label htmlFor="st-avatar">Profile photo (optional)</label>
            <input id="st-avatar" name="avatar" type="file" accept="image/*" className="small" />
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

        {homes.map((h) => (
          <details key={h.assetId} className="card">
            <summary className="section-title" style={{ cursor: "pointer", marginBottom: 0 }}>
              Sell your home — {h.projectName}
            </summary>
            <form action={renameHome.bind(null, h.projectId)} className="btn-row" style={{ marginTop: 10 }}>
              <input name="name" className="input" defaultValue={h.projectName} style={{ maxWidth: 240 }} />
              <button className="btn ghost">Rename</button>
            </form>
            <form action={saveAskingPrice} style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <p className="muted small" style={{ margin: 0 }}>
              Name your price and sell direct — no realtors, no commission.
              {h.askingPrice
                ? ` Currently listed at $${Number(h.askingPrice).toLocaleString()}.`
                : " Leave empty to keep it off the market."}
            </p>
            <input type="hidden" name="asset" value={h.assetId} />
            <div className="btn-row">
              <input
                name="price"
                className="input"
                inputMode="numeric"
                placeholder="e.g. 1,850,000"
                defaultValue={h.askingPrice ? String(h.askingPrice) : ""}
                style={{ maxWidth: 200 }}
              />
              <button className="btn">{h.askingPrice ? "Update price" : "List it"}</button>
            </div>
            {h.address && <p className="muted small" style={{ margin: 0 }}>{h.address}</p>}
            </form>
          </details>
        ))}
        {homes.length === 0 && (
          <div className="card">
            <h2 className="section-title">Sell your home</h2>
            <p className="muted small" style={{ margin: 0 }}>
              Claim your address on the home page first — then you can name a
              direct-sale price here.
            </p>
          </div>
        )}

        {/* Contacts: every house's approved people, editable in place. */}
        {contactHouses.map((h) => (
          <div key={h.project_id} className="card" style={{ display: "grid", gap: 6, minWidth: 0, overflow: "hidden" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Contacts · {h.project_name} · {h.people.length}</h2>
            {h.people.length === 0 && <p className="muted small" style={{ margin: 0 }}>No approved people on this project yet.</p>}
            {h.people.length > 0 && (
              <div className="muted" style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr 1.2fr 0.8fr", gap: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                <span>Trade</span><span>Name</span><span>Phone</span><span>Email</span><span>Role</span>
              </div>
            )}
            {h.people.map((p) => (
              <details key={p.contact_id} style={{ borderTop: "1px solid #eef0ec", paddingTop: 6, minWidth: 0 }}>
                <summary className="small" style={{ cursor: "pointer", listStyle: "none", display: "grid", gridTemplateColumns: "1fr 1.4fr 1fr 1.2fr 0.8fr", gap: 8, alignItems: "center", minWidth: 0 }}>
                  <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.trade ?? "—"}</span>
                  <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.phone ? <a href={`tel:${p.phone}`} style={{ textDecoration: "none" }}>{p.phone}</a> : <span className="muted">—</span>}
                  </span>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.email ? <a href={`mailto:${p.email}`} style={{ textDecoration: "none" }}>{p.email}</a> : <span className="muted">—</span>}
                  </span>
                  <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.role} ✏️</span>
                </summary>
                <form action={updateContact} style={{ display: "grid", gap: 6, padding: "6px 0 4px" }}>
                  <input type="hidden" name="contact" value={p.contact_id} />
                  <input type="hidden" name="back" value="/my/settings" />
                  <div className="form-2col">
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Name</label>
                      <input name="name" className="input" defaultValue={p.name} />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Trade</label>
                      <input name="trade" className="input" defaultValue={p.trade ?? ""} placeholder="e.g. Plumbing" />
                    </div>
                  </div>
                  <div className="form-2col">
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Phone</label>
                      <input name="phone" className="input" type="tel" defaultValue={p.phone ?? ""} />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label>Email</label>
                      <input name="email" className="input" type="email" defaultValue={p.email ?? ""} />
                    </div>
                  </div>
                  <div className="field" style={{ marginBottom: 0 }}>
                    <label>Notes</label>
                    <input name="notes" className="input" defaultValue={p.notes ?? ""} />
                  </div>
                  <div><button className="btn small">Save contact</button></div>
                </form>
              </details>
            ))}
          </div>
        ))}

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
                    <button className="btn ghost small" style={{ color: "#c0262d", borderColor: "#e3b7ba" }}>Delete now</button>
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
