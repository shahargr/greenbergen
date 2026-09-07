import Link from "next/link";
import { AppBar, Blueprint, Screen } from "@shared/ui";

export default function NotFound() {
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <Blueprint pad>
          <h1>Nothing here.</h1>
          <p className="lead text-muted" style={{ margin: 0 }}>That page doesn&apos;t exist, or it was shared with someone else. The packages are one tap away.</p>
        </Blueprint>
      </div>
      <div className="actions">
        <Link href="/packages" className="btn btn-primary btn-block blueprint">Browse packages</Link>
        <Link href="/" className="btn btn-ghost btn-block">Start over</Link>
      </div>
    </Screen>
  );
}
