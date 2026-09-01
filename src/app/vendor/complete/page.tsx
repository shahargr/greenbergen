import { SiteHeader } from "@/components/SiteHeader";
import { CompleteForm } from "./CompleteForm";

export default function VendorCompletePage() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="wrap" style={{ flex: 1, width: "100%", maxWidth: 680, paddingBottom: 64 }}>
        <h1 style={{ fontSize: 26, margin: "12px 0 4px" }}>Complete your business profile</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          For registered service providers — verify your phone, fill in the rest.
        </p>
        <CompleteForm />
      </main>
    </div>
  );
}
