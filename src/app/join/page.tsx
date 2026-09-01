import Link from "next/link";

export default function JoinPage() {
  return (
    <main className="wrap" style={{ paddingTop: 64, paddingBottom: 96, maxWidth: 640 }}>
      <h1>Join</h1>
      <p className="muted">
        Homeowners join by invitation today — ask us for one. Vendors and
        partners: reach out and we&apos;ll set you up. Self-serve signup is
        coming soon.
      </p>
      <Link href="/login">Sign in</Link> · <Link href="/">Back home</Link>
    </main>
  );
}
