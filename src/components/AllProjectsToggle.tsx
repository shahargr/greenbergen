import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { setGodMode } from "@/app/admin/actions";

// EVERY PROJECT, OR ONLY MINE - ON THE PROJECTS PAGE, WHERE PROJECTS ARE.
//
// Shahar, 2026-09-20: "remove all projects from under the setup tab / they
// should be kept in the project page."
//
// This card was the first thing on /admin/console, which is the gear on the
// admin door. It is the one control that decides whether a list shows the
// whole platform or only your seats - so it belongs ON the list it changes,
// not two screens away behind a gear. The console keeps the things that are
// about WHO you are; this is about WHAT is shown, and it moved with the
// projects.
//
// It reads its own cookie and its own permission rather than taking props, so
// wherever it is dropped it is correct: nothing for a non-superadmin, and the
// cookie is only honoured for one anyway (setGodMode re-checks).
export async function AllProjectsToggle({ back }: { back: string }) {
  const supabase = await createClient();
  const { data: me } = await supabase.rpc("me");
  if (!me?.is_superadmin) return null;

  const godOn = (await cookies()).get("gb_god")?.value === "1";

  return (
    <div className="card" style={{ borderLeft: godOn ? "4px solid var(--danger)" : undefined, marginBottom: 12 }}>
      <h2 className="section-title" style={{ marginTop: 0 }}>All projects</h2>
      <p className="small" style={{ marginTop: 0 }}>
        {godOn
          ? <>You are seeing <strong>every project on the platform</strong>, with full rights and a red banner on
              each one you are not a member of.</>
          : <>You are seeing <strong>only the projects you hold a seat on</strong> — the platform&rsquo;s own list is
              hidden until you turn this on.</>}
      </p>
      <p className="muted tiny" style={{ margin: "0 0 10px" }}>
        This never grants access; a superadmin already has it. It only decides what gets listed.
      </p>
      <form action={setGodMode}>
        <input type="hidden" name="back" value={back} />
        <input type="hidden" name="on" value={godOn ? "0" : "1"} />
        <button className="btn" style={godOn ? undefined : { background: "var(--danger)" }}>
          {godOn ? "Show only my projects" : "Show every project"}
        </button>
      </form>
    </div>
  );
}
