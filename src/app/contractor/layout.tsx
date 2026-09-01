import { TopNav } from "@/components/TopNav";

export default function ContractorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <TopNav role="Contractor" />
      {children}
    </>
  );
}
