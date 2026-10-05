import { redirect } from "next/navigation";
import { getMe } from "@/lib/serverMe";
import { TopNav } from "@/components/TopNav";
import { AdminNav } from "@/components/AdminNav";

export const dynamic = "force-dynamic";

// The database (RLS + is_superadmin()) is the real boundary - every admin
// query already runs as the session's user. This gate keeps the admin
// SHELL from even rendering for anyone else.
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const me = await getMe();
  if (!me?.is_superadmin) redirect("/my");

  return (
    <>
      <TopNav role="Admin" />
      <div className="admin-shell wrap">
        <AdminNav />
        <div className="admin-main">{children}</div>
      </div>
    </>
  );
}
