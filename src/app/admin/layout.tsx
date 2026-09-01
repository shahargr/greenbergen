import { TopNav } from "@/components/TopNav";
import { AdminNav } from "@/components/AdminNav";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
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
