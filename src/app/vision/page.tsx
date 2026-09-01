import Link from "next/link";

export default function VisionPage() {
  return (
    <main className="wrap" style={{ paddingTop: 64, paddingBottom: 96, maxWidth: 640 }}>
      <h1>Vision</h1>
      <p className="muted">
        One home at a time: every owner deserves a clear view of the work, the
        people and the money behind their home. Full story coming soon.
      </p>
      <Link href="/">&larr; Back home</Link>
    </main>
  );
}
