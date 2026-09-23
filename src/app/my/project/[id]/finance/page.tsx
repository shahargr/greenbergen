import { redirect } from "next/navigation";

// The finance wizard lives INSIDE the project now - in the professionals
// app (Shahar, 2026-09-23: "admin has nothing to do with the build project -
// its a layer on top. any financial portal must sit inside each project").
// This portal route survives only so old links keep working; the admin
// layer's own future here is building the DIY packages and the rest of the
// catalogue, not per-project money.
export default async function FinanceRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/pro/project/${id}/finance`);
}
