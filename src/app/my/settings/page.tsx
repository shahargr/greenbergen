import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { saveProfile, emptyRecycleBin } from "./actions";
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
  searchParams: Promise<{ saved?: string; error?: string; verified?: string ; contractors?: string }>;
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
  // Account facts for the right column; the contractor's bids by project.
  const [{ data: acct }, { data: bidProjData }, { data: ownerProjData }, { data: myTradeRows }] = await Promise.all([
    me?.app_user_id ? supabase.from("app_users").select("created_at, last_modified_at, last_login_at").eq("id", me.app_user_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.rpc("portal_my_bid_projects"),
    supabase.rpc("portal_my_owner_projects"),
    me?.contact_id
      ? supabase.from("contact_trade_roles").select("trade").eq("contact_id", me.contact_id)
      : Promise.resolve({ data: [] }),
  ]);
  // The trades you offer, shown under your name.
  const myTrades = [...new Set(((myTradeRows ?? []) as { trade: string }[]).map((t) => t.trade))].sort();
  type BidProj = { project_id: string; project_name: string; address: string | null; status: string; parent_name: string | null; kind: "awarded" | "pending you" | "pending customer" | "not awarded"; bids: number; amount: number | null };
  const bidProjects = ((bidProjData ?? []) as BidProj[]);
  type OwnerProj = { project_id: string; project_name: string; address: string | null; status: string;
    stage: string | null; parent_name: string | null; packages: number; contracts: number;
    open_tasks: number; bucket: "idea" | "active" | "completed" };
  const firstName = (me?.full_name ?? "").trim().split(/\s+/)[0] || null;
  const fmtD = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—");
  // Everyone ever added to one of my projects, at any role.
  type MyContractor = { id: string; name: string; company: string | null; trade: string | null; stage: string | null; phone: string | null; email: string | null; seats: string[] | null; is_owner?: boolean; projects: number; awarded: number; status?: "awarded" | "bidding" | "not awarded" | "member"; vendor_status: string | null };
  const { data: contractorsData } = await supabase.rpc("portal_my_contractors");
  const contractors = ((contractorsData ?? []) as MyContractor[]);
  // Not-awarded bidders fold away unless asked for (?contractors=all).
  const showAllContractors = (await searchParams).contractors === "all";
  const visibleContractors = showAllContractors ? contractors : contractors.filter((c) => c.status !== "not awarded");
  const hiddenContractors = contractors.length - visibleContractors.length;
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
  // Media across my projects: latest files, thumbnails signed for an hour.
  const mediaIds = [...memProjects.keys()];
  const { data: mediaRows } = mediaIds.length
    ? await supabase.from("files").select("id, file_name, kind, mime_type, bucket, path, created_at, project_id, caption").in("project_id", mediaIds).order("created_at", { ascending: false }).limit(24)
    : { data: [] };
  type MediaRow = { id: string; file_name: string; kind: string | null; mime_type: string | null; bucket: string; path: string; created_at: string; project_id: string; caption: string | null };
  const media = ((mediaRows ?? []) as MediaRow[]);
  const mediaUrls = new Map<string, string>();
  await Promise.all(media.map(async (m) => {
    const { data: s } = await supabase.storage.from(m.bucket).createSignedUrl(m.path, 3600);
    if (s?.signedUrl) mediaUrls.set(m.id, s.signedUrl);
  }));
  const trashDays: number = trashData?.days ?? 14;
  const trashItems = ((trashData?.items ?? []) as { id: string; name: string; trashed_at: string; expires_on: string }[]);

  const ownerProjects = ((ownerProjData ?? []) as OwnerProj[]);
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

  const avatarUrl = contact?.avatar_path
    ? `${supabase.storage.from("public-media").getPublicUrl(contact.avatar_path).data.publicUrl}?v=${Date.parse(acct?.last_modified_at ?? "") || 0}`
    : null;

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
      <h1 style={{ fontSize: 26, margin: "6px 0 14px" }}>
        {firstName ? `${firstName}'s account setup` : "Account setup"}
      </h1>

      {error && <p className="error small">{error}</p>}

      <div style={{ display: "grid", gap: 14 }}>
        {/* One account panel: who you are, when you joined, and the form to
            change any of it — folded in rather than a card of its own. */}
        <div className="card" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: avatarUrl ? "auto minmax(0, 1fr) minmax(0, auto)" : "minmax(0, 1fr) minmax(0, auto)", gap: 12, alignItems: "start" }}>
            {avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt="" style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", border: "1px solid #e7e9e4" }} />
            )}
            <span style={{ minWidth: 0 }}>
              <strong style={{ fontSize: 16 }}>{me?.full_name ?? "Unnamed"}</strong>
              {me?.is_superadmin && <span className="extra-chip" style={{ marginLeft: 8 }}>admin</span>}
              {myTrades.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                  {myTrades.map((t) => <span key={t} className="extra-chip" style={{ fontSize: 11 }}>{t}</span>)}
                </div>
              )}
              {myTrades.length === 0 && <div className="muted small" style={{ marginTop: 2 }}>No trades listed yet</div>}
            </span>
            <span className="small" style={{ display: "grid", gap: 2, textAlign: "right", whiteSpace: "nowrap", minWidth: 0 }}>
              <span className="muted" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>Signed in as <strong style={{ color: "var(--ink)" }}>{me?.email}</strong></span>
              <span><span className="muted">Member since</span> {fmtD(acct?.created_at)}</span>
              <span><span className="muted">Last updated</span> {fmtD(acct?.last_modified_at ?? acct?.created_at)}</span>
              {acct?.last_login_at && <span><span className="muted">Last login</span> {fmtD(acct.last_login_at)}</span>}
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", borderTop: "1px solid #eef0ec", paddingTop: 8 }}>
            <span className="muted small">The details you change often are here; everything else, including trades and licences, is on the full form.</span>
            <Link href="/my/profile" className="btn ghost small" style={{ whiteSpace: "nowrap" }}>Full details →</Link>
          </div>
          <details>
            <summary className="small" style={{ cursor: "pointer", fontWeight: 700 }}>✏️ Edit your details</summary>
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
            <label htmlFor="st-address">Office address</label>
            <input id="st-address" name="address" className="input"
              defaultValue={contact?.address ?? homes[0]?.address ?? ""} />
            {!contact?.address && homes[0]?.address && (
              <p className="muted small" style={{ margin: "4px 0 0" }}>
                Pre-filled from the address you claimed — hit Save to keep it.
              </p>
            )}
          </div>
          <div>
            <button className="btn">Save</button>
          </div>
          </form>
          </details>
        </div>

        {/* Superadmin controls, right where the account is. */}
        {me?.is_superadmin && (
          <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", borderLeft: godOn ? "4px solid #7a1f2b" : undefined }}>
            <span>
              <strong>⚡ God mode · {godOn ? "ON" : "off"}</strong>
              <div className="muted small">ON: every project on the platform, full admin rights, red banner on each page. OFF: only projects you hold a seat on.</div>
            </span>
            <form action={setGodMode}>
              <input type="hidden" name="back" value="/my/settings" />
              <input type="hidden" name="on" value={godOn ? "0" : "1"} />
              <button className="btn small" style={godOn ? undefined : { background: "#7a1f2b" }}>{godOn ? "Turn off" : "Turn on"}</button>
            </form>
          </div>
        )}

        {/* The console is its own door, not part of the god-mode switch. */}
        {me?.is_superadmin && (
          <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>
              <strong>Admin console</strong>
              <div className="muted small">Users, projects, storage, deals and the rest of the platform.</div>
            </span>
            <Link href="/admin" className="btn ghost small">Open console →</Link>
          </div>
        )}

        {/* What you have here, grouped by what you are. A contractor reads
            bids by who owes the next move; an owner reads projects by how far
            along they are. */}
        {(() => {
          const bidGroups: [string, string, BidProj[]][] = [
            ["📨", "Bids pending you", bidProjects.filter((b) => b.kind === "pending you")],
            ["⏳", "Bids pending customer", bidProjects.filter((b) => b.kind === "pending customer")],
            ["✅", "Bids awarded", bidProjects.filter((b) => b.kind === "awarded")],
          ];
          const lost = bidProjects.filter((b) => b.kind === "not awarded");
          const ownerGroups: [string, string, OwnerProj[]][] = [
            ["💡", "Project ideas", ownerProjects.filter((o) => o.bucket === "idea")],
            ["🔨", "Projects active", ownerProjects.filter((o) => o.bucket === "active")],
            ["🏁", "Projects completed", ownerProjects.filter((o) => o.bucket === "completed")],
          ];
          const line = (href: string, name: string, sub: string | null, right: string) => (
            <div key={href} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, borderTop: "1px solid #eef0ec", paddingTop: 6, minWidth: 0 }}>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <Link href={href} style={{ fontWeight: 600 }}>{name}</Link>
                {sub && <span className="muted"> · {sub}</span>}
              </span>
              <span className="muted" style={{ whiteSpace: "nowrap" }}>{right}</span>
            </div>
          );
          return (
            <>
              {bidProjects.length > 0 && (
                <div className="card" style={{ display: "grid", gap: 8 }}>
                  <h2 className="section-title" style={{ margin: 0 }}>Your bids · {bidProjects.length}</h2>
                  {bidGroups.map(([icon, title, rows]) => (
                    <div key={title} style={{ display: "grid", gap: 4 }}>
                      <strong className="small">{icon} {title} · {rows.length}</strong>
                      {rows.length === 0 && <span className="muted small">None.</span>}
                      {rows.map((b) => line(`/my/project/${b.project_id}`, b.project_name, b.parent_name,
                        `${b.amount != null ? `$${Math.round(b.amount).toLocaleString()} · ` : ""}${b.bids} bid${b.bids === 1 ? "" : "s"}`))}
                    </div>
                  ))}
                  {lost.length > 0 && (
                    <details>
                      <summary className="small muted" style={{ cursor: "pointer" }}>Not awarded · {lost.length}</summary>
                      <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                        {lost.map((b) => line(`/my/project/${b.project_id}`, b.project_name, b.parent_name, b.status))}
                      </div>
                    </details>
                  )}
                </div>
              )}

              {ownerProjects.length > 0 && (
                <div className="card" style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                    <h2 className="section-title" style={{ margin: 0 }}>Your projects · {ownerProjects.length}</h2>
                    <Link href="/my/new-project" className="small" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>＋ Start a project</Link>
                  </div>
                  {ownerGroups.map(([icon, title, rows]) => (
                    <div key={title} style={{ display: "grid", gap: 4 }}>
                      <strong className="small">{icon} {title} · {rows.length}</strong>
                      {rows.length === 0 && <span className="muted small">None.</span>}
                      {rows.map((o) => line(`/my/project/${o.project_id}`, o.project_name, o.parent_name ?? o.address,
                        o.bucket === "completed" ? (o.stage ?? o.status)
                          : o.bucket === "idea" ? "nothing bid yet"
                          : `${o.open_tasks} open · ${o.contracts} contract${o.contracts === 1 ? "" : "s"}`))}
                    </div>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* Your contractors: anyone ever added to a project of yours, at any
            role. Each row opens the person's page. */}
        <div className="card" style={{ display: "grid", gap: 6, overflowX: "auto" }}>
          {/* Owners and contractors are different people: title by what the
              list actually holds, and mark owners so nobody reads a landlord
              as a tradesman. */}
          <h2 className="section-title" style={{ margin: 0 }}>
            {contractors.some((c) => !c.is_owner) && contractors.some((c) => c.is_owner)
              ? "People on your projects"
              : contractors.every((c) => c.is_owner) && contractors.length > 0
                ? "Owners you work with"
                : "Your contractors"} · {contractors.length}
          </h2>
          {hiddenContractors > 0 && !showAllContractors && <p className="small" style={{ margin: 0 }}><Link href="/my/settings?contractors=all">View all · {hiddenContractors} not awarded hidden</Link></p>}
          {showAllContractors && hiddenContractors === 0 && contractors.some((c) => c.status === "not awarded") && <p className="small" style={{ margin: 0 }}><Link href="/my/settings">Hide not awarded</Link></p>}
          {contractors.length === 0 && <p className="muted small" style={{ margin: 0 }}>No one on your projects yet.</p>}
          {contractors.length > 0 && (
            // Ordered by the project phase the trade belongs to. Phone and
            // text are icons: tap to call or message. (Recording those
            // calls/texts per retention policy is a logged future task.)
            <table className="tasktable" style={{ width: "100%" }}>
              <thead><tr><th>Trade</th><th>Name</th><th>Role</th><th>Status</th><th style={{ textAlign: "center" }}>Call</th><th style={{ textAlign: "center" }}>Text</th></tr></thead>
              <tbody>
                {visibleContractors.map((c, i) => {
                  const newStage = i === 0 || visibleContractors[i - 1].stage !== c.stage;
                  return (
                    <tr key={c.id}>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {c.is_owner ? <span className="extra-chip" style={{ background: "#e6f2ea", color: "#1f6b45" }}>🏠 Owner</span> : (c.trade ?? <span className="muted">—</span>)}
                        {newStage && c.stage && !c.is_owner && <div className="muted" style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.4 }}>{c.stage}</div>}
                      </td>
                      <td>
                        <Link href={`/my/contractor/${c.id}`} style={{ fontWeight: 600 }}>{c.name}</Link>
                        <div className="muted small">
                          {c.company && c.company !== c.name ? `${c.company} · ` : ""}{c.projects} project{c.projects === 1 ? "" : "s"}{c.awarded > 0 ? ` · ${c.awarded} awarded` : ""}
                        </div>
                      </td>
                      <td className="small">{c.seats?.length ? c.seats.join(", ") : <span className="muted">—</span>}</td>
                      <td className="small">
                        {c.status === "awarded" ? <span className="extra-chip" style={{ background: "#e6f2ea", color: "#1f6b45" }}>awarded</span>
                          : c.status === "bidding" ? <span className="extra-chip" style={{ background: "#fdf4e3", color: "#a8842c" }}>bidding</span>
                          : c.status === "not awarded" ? <span className="extra-chip" style={{ background: "#f0f1ee", color: "#7b857e" }}>not awarded</span>
                          : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {c.phone ? <a href={`tel:${c.phone}`} title={`Call ${c.phone}`} aria-label={`Call ${c.name}`} style={{ textDecoration: "none", fontSize: 18 }}>📞</a> : <span className="muted">—</span>}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {c.phone ? <a href={`sms:${c.phone}`} title={`Text ${c.phone}`} aria-label={`Text ${c.name}`} style={{ textDecoration: "none", fontSize: 18 }}>💬</a> : <span className="muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Add property: the action sits on the card's own top bar. */}
        <form action={createHome} className="card" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <h2 className="section-title" style={{ margin: 0 }}>Add property</h2>
            <button className="btn small">Save</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Another property you own gets its own home page, projects and paperwork.
          </p>
          <div className="form-2col">
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="ap-name">What should we call it?</label>
              <input id="ap-name" name="name" className="input" required autoComplete="off" placeholder="The Tenafly house" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label htmlFor="ap-address">Address</label>
              <input id="ap-address" name="address" className="input" required placeholder="12 Maple Ave, Tenafly NJ" />
            </div>
          </div>
        </form>

        {trashItems.length > 0 && (
          <div className="card" style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <h2 className="section-title" style={{ margin: 0 }}>Recycle bin · {trashItems.length}</h2>
              <form action={emptyRecycleBin}><button className="btn ghost small" style={{ color: "#c0262d", borderColor: "#e3b7ba" }}>Empty all</button></form>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              Deleted projects stay restorable for {trashDays} days, then purge automatically.
            </p>
            {trashItems.map((t) => (
              <div key={t.id} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span>
                  <strong>{t.name}</strong>
                  <span className="muted"> · purges in {Math.max(0, Math.ceil((new Date(t.expires_on + "T12:00:00").getTime() - Date.now()) / 86400000))} days</span>
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

        {/* Media: the latest files across your projects, four to a row. */}
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <h2 className="section-title" style={{ margin: 0 }}>Media · {media.length}</h2>
          {media.length === 0 && <p className="muted small" style={{ margin: 0 }}>No photos or files on your projects yet.</p>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
            {media.map((m) => {
              const u = mediaUrls.get(m.id);
              const isImg = (m.mime_type ?? "").startsWith("image/") || m.kind === "photo";
              const icon = m.kind === "audio" ? "🎙" : m.kind === "video" ? "🎬" : "📄";
              const proj = memProjects.get(m.project_id)?.project_name ?? "";
              return (
                <a key={m.id} href={u ?? "#"} target="_blank" rel="noreferrer" title={`${m.file_name} · ${proj}`} style={{ display: "grid", gap: 2, textDecoration: "none", color: "inherit", minWidth: 0 }}>
                  {isImg && u
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={u} alt={m.file_name} style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "cover", borderRadius: 8, border: "1px solid #e7e9e4" }} />
                    : <span style={{ display: "grid", placeItems: "center", width: "100%", aspectRatio: "1 / 1", borderRadius: 8, border: "1px solid #e7e9e4", background: "#f7f8f5", fontSize: 22 }}>{icon}</span>}
                  <span style={{ fontSize: 10, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.caption ?? m.file_name}</span>
                  <span className="muted" style={{ fontSize: 10, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj} · {new Date(m.created_at).toLocaleDateString()}</span>
                </a>
              );
            })}
          </div>
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
