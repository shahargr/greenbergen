import Link from "next/link";

export default function HelpPage() {
  return (
    <main className="wrap" style={{ paddingTop: 64, paddingBottom: 96, maxWidth: 640 }}>
      <h1>Help</h1>
      <p className="muted">
        Questions about your project or your account? Call us, or sign in and
        message us from your home page. A proper help center is coming soon.
      </p>
      <Link href="/">&larr; Back home</Link>
    </main>
  );
}
