import { TopNav } from "@/components/TopNav";

export default function MyLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <TopNav role="Owner" />
      {children}
    </>
  );
}
