import { createClient } from "@/lib/supabase/server";
import { saveProfile, saveAskingPrice } from "./actions";

type HomeAsset = {
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
  const { data: me } = await supabase.rpc("me");

  const { data: contact } = me?.contact_id
    ? await supabase
        .from("contacts")
        .select("phone, address")
        .eq("id", me.contact_id)
        .maybeSingle()
    : { data: null };

  const { data: homeProjects } = await supabase
    .from("projects")
    .select("project_name, address, asset_id")
    .not("asset_id", "is", null)
    .is("parent_project_id", null);

  const assetIds = (homeProjects ?? []).map((p) => p.asset_id as string);
  const { data: assets } = assetIds.length
    ? await supabase.from("assets").select("id, asking_price").in("id", assetIds)
    : { data: [] };

  const homes: HomeAsset[] = (homeProjects ?? []).map((p) => ({
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
            <label htmlFor="st-address">Full address</label>
            <input id="st-address" name="address" className="input" defaultValue={contact?.address ?? ""} />
          </div>
          <p className="muted small" style={{ margin: 0 }}>Signed in as {me?.email}.</p>
          <div>
            <button className="btn">Save</button>
          </div>
        </form>

        {homes.map((h) => (
          <form key={h.assetId} action={saveAskingPrice} className="card" style={{ display: "grid", gap: 10 }}>
            <h2 className="section-title">Sell your home — {h.projectName}</h2>
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
