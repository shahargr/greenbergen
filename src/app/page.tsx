import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="wrap" style={{ paddingTop: 96, paddingBottom: 96 }}>
      <p style={{ letterSpacing: 2, fontSize: 13, textTransform: "uppercase" }} className="muted">
        Green Bergen
      </p>
      <h1 style={{ fontSize: 40, lineHeight: 1.15, margin: "8px 0 16px", maxWidth: 560 }}>
        Your home, managed like a project.
      </h1>
      <p className="muted" style={{ maxWidth: 520, marginBottom: 32 }}>
        We build, improve and manage homes in Bergen County — and give every
        owner a live view of the work, the people and the money.
      </p>
      {user ? (
        <Link className="btn" href="/my">Open your home</Link>
      ) : (
        <Link className="btn" href="/login">Sign in</Link>
      )}
    </main>
  );
}
