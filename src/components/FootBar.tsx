import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

// The public foot bar. Sits on every page from the root layout - but a
// signed-in user is past the marketing shell, so it renders nothing for them.
export async function FootBar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return null;

  return (
    <footer className="footbar">
      <nav className="wrap footnav">
        <Link href="/vision">Vision</Link>
        <Link href="/join">Join</Link>
      </nav>
    </footer>
  );
}
