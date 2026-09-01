import Link from "next/link";

export default function SettingsPage() {
  return (
    <main className="wrap" style={{ paddingTop: 48, maxWidth: 560 }}>
      <span className="kicker">Settings</span>
      <h1 style={{ fontSize: 24, margin: "6px 0 10px" }}>Settings</h1>
      <p className="muted">To be developed — your account and notification preferences will live here.</p>
      <Link href="/my">&larr; Back</Link>
    </main>
  );
}
