import { createClient } from "@/lib/supabase/server";
import { recordStorageOp, setUserPlan, setUserQuota } from "./actions";

export const dynamic = "force-dynamic";

type UserStorage = {
  user_id: string; name: string; email: string; is_super: boolean;
  plan_code: string; quota_bytes: number | null; used_bytes: number; file_count: number;
  cap_voice: boolean; cap_image: boolean; cap_video: boolean; cap_document: boolean;
  has_quota_override: boolean;
};

type Stats = {
  ok: boolean;
  buckets: { bucket: string; objects: number; bytes: number }[];
  total_objects: number;
  total_bytes: number;
  db_bytes: number;
  last_backup_at: string | null;
  last_optimization_at: string | null;
  backup_days_ago: number | null;
  optimization_days_ago: number | null;
  backup_stale: boolean;
};

const fmtBytes = (b: number) => {
  if (b < 1024) return `${b} B`;
  const u = ["KB", "MB", "GB", "TB"];
  let n = b / 1024, i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i += 1; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
};
const fmtWhen = (s: string | null) => (s ? new Date(s).toLocaleDateString() : "Never");
const daysLabel = (d: number | null) => (d == null ? null : d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`);

export default async function StoragePage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;
  const supabase = await createClient();
  const [{ data }, { data: usersData }, { data: planRows }] = await Promise.all([
    supabase.rpc("storage_stats"),
    supabase.rpc("storage_by_user"),
    supabase.from("plans").select("code, name").eq("is_active", true).order("sort_order"),
  ]);
  const s = (data ?? null) as Stats | null;
  const users = ((usersData ?? []) as UserStorage[]);
  const plans = ((planRows ?? []) as { code: string; name: string }[]);

  if (!s?.ok) {
    return <p className="muted">Storage stats are for administrators.</p>;
  }

  const backupAgo = daysLabel(s.backup_days_ago);
  const optAgo = daysLabel(s.optimization_days_ago);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>Storage &amp; backup</h1>
      {saved && <p className="banner" style={{ background: "#2f6b4f" }}>Recorded ✓</p>}
      {error && <p className="error small">{error}</p>}

      <div className="youband" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        <div className="tile" style={{ cursor: "default" }}>
          <span className="tile-label">Media objects</span>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{s.total_objects.toLocaleString()}</span>
          <span className="tile-sub">{fmtBytes(s.total_bytes)} in storage</span>
        </div>
        <div className="tile" style={{ cursor: "default" }}>
          <span className="tile-label">Database</span>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{fmtBytes(s.db_bytes)}</span>
          <span className="tile-sub">rows, indexes &amp; metadata</span>
        </div>
        <div className="tile" style={{ cursor: "default" }}>
          <span className="tile-label">Total footprint</span>
          <span style={{ fontSize: 22, fontWeight: 800 }}>{fmtBytes(s.total_bytes + s.db_bytes)}</span>
          <span className="tile-sub">storage + database</span>
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title">By bucket</h2>
        {s.buckets.map((b) => (
          <div key={b.bucket} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
            <strong>{b.bucket}</strong>
            <span className="muted">{b.objects.toLocaleString()} objects · {fmtBytes(b.bytes)}</span>
          </div>
        ))}
        {s.buckets.length === 0 && <p className="muted small" style={{ margin: 0 }}>No media stored yet.</p>}
      </div>

      <div className="card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>By user · quota &amp; plan</h2>
          <span className="muted small">Consumption per user, right now.</span>
        </div>
        {users.length === 0 && <p className="muted small" style={{ margin: 0 }}>No users.</p>}
        {users.map((u) => {
          const unlimited = u.quota_bytes == null;
          const pct = unlimited ? 0 : u.quota_bytes! > 0 ? Math.min(100, (u.used_bytes / u.quota_bytes!) * 100) : u.used_bytes > 0 ? 100 : 0;
          const over = !unlimited && u.quota_bytes! > 0 && u.used_bytes > u.quota_bytes!;
          const caps = [u.cap_voice && "voice", u.cap_image && "image", u.cap_video && "video", u.cap_document && "docs"].filter(Boolean).join(" · ");
          return (
            <div key={u.user_id} style={{ display: "grid", gap: 6, borderTop: "1px solid #eef0ec", paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>
                  {u.name}{u.is_super && <span className="muted" style={{ fontWeight: 400 }}> · admin</span>}
                </span>
                <span className="small" style={{ whiteSpace: "nowrap" }}>
                  <strong style={{ color: over ? "#c0262d" : undefined }}>{fmtBytes(u.used_bytes)}</strong>
                  <span className="muted"> / {unlimited ? "∞" : fmtBytes(u.quota_bytes!)}</span>
                  <span className="muted"> · {u.file_count} file{u.file_count === 1 ? "" : "s"}</span>
                </span>
              </div>
              {!unlimited && (
                <div className="progressbar" style={{ background: "#eceee9" }}>
                  <span style={{ width: `${pct}%`, background: over ? "#c0262d" : "#2f6b4f", display: "inline-block", height: "100%" }} />
                </div>
              )}
              <div className="muted" style={{ fontSize: 11 }}>Can upload: {caps || "nothing"}</div>
              {!u.is_super && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <form action={setUserPlan.bind(null, u.user_id)} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <select name="plan" defaultValue={u.plan_code} className="input small" style={{ height: 30, padding: "2px 6px" }}>
                      {plans.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                    </select>
                    <button className="btn ghost small">Set plan</button>
                  </form>
                  <form action={setUserQuota.bind(null, u.user_id)} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <input name="mb" placeholder={u.has_quota_override ? "override MB" : "MB override"} inputMode="decimal"
                      className="input small" style={{ height: 30, width: 110, padding: "2px 6px" }}
                      defaultValue={u.has_quota_override && u.quota_bytes != null ? Math.round(u.quota_bytes / (1024 * 1024)) : ""} />
                    <button className="btn ghost small">Set quota</button>
                  </form>
                  {u.has_quota_override && <span className="muted" style={{ fontSize: 11 }}>custom quota (blank = plan default)</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <h2 className="section-title">Backup</h2>
        <div className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            Last backup: <strong style={{ color: s.backup_stale ? "#c0262d" : "inherit" }}>{fmtWhen(s.last_backup_at)}</strong>
            {backupAgo && <span className="muted"> · {backupAgo}</span>}
          </span>
          <form action={recordStorageOp.bind(null, "backup")}>
            <button className="btn ghost small">Record backup now</button>
          </form>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Supabase keeps automatic daily backups of the database. Record here when you take an out-of-band snapshot.
        </p>
      </div>

      <div className="card" style={{ display: "grid", gap: 10 }}>
        <h2 className="section-title">Storage optimization</h2>
        <div className="small" style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <span>
            Last run: <strong>{fmtWhen(s.last_optimization_at)}</strong>
            {optAgo && <span className="muted"> · {optAgo}</span>}
          </span>
          <form action={recordStorageOp.bind(null, "optimization")}>
            <button className="btn ghost small">Record optimization now</button>
          </form>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Optimization moves media bytes off the primary store into cheaper external / shared storage to lower fees.
          The automated job is not built yet — this records when it is run.
        </p>
      </div>
    </div>
  );
}
