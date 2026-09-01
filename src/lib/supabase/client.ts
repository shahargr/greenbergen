// Publishable by design (the anon key ships in every browser bundle; RLS is
// the boundary). Env vars override these defaults when set.
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://oznqiwldgjrykadqsriv.supabase.co",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bnFpd2xkZ2pyeWthZHFzcml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMjkxNDgsImV4cCI6MjEwMTgwNTE0OH0.FxHIbx_8JBdcCocH3UcX4aaFoRMXKQ3U2lsOXec8fb4",
  );
}
