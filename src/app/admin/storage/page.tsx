import { createClient } from "@/lib/supabase/server";
import { recordStorageOp } from "./actions";

export const dynamic = "force-dynamic";

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
  const { data } = await supabase.rpc("storage_stats");
  const s = (data ?? null) as Stats | null;

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
