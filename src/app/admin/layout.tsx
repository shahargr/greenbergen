import { TopNav } from "@/components/TopNav";
import { AdminTabs } from "@/components/AdminTabs";

export default function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <TopNav role="Admin" />
      <AdminTabs />
      {children}
    </>
  );
}
