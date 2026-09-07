// The project's publishable pair. Same database as the owner portal
// (project ref oznqiwldgjrykadqsriv); the anon key is public by design and
// RLS plus the function grants are the boundary.
export const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://oznqiwldgjrykadqsriv.supabase.co";
export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96bnFpd2xkZ2pyeWthZHFzcml2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyMjkxNDgsImV4cCI6MjEwMTgwNTE0OH0.FxHIbx_8JBdcCocH3UcX4aaFoRMXKQ3U2lsOXec8fb4";
