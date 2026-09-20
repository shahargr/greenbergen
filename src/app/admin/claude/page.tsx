import { PermissionBuilder } from "./PermissionBuilder";

export const metadata = { title: "Supabase permissions · Admin" };

// WHAT AN AGENT MAY DO HERE WITHOUT STOPPING TO ASK.
//
// Shahar asked for a screen to "set my own permissions while working with
// Supabase ... so Claude does not need to pause asking me for permissions",
// showing three Execute SQL dialogs.
//
// THE HONEST SHAPE OF THIS SCREEN. A page in this app cannot grant an agent
// anything. The dialog is drawn by the Claude Code harness, which decides in
// two places, neither of them here:
//
//   1. permission rules - allow / ask / deny, read out of .claude/settings.json
//      in the repository, ONCE, when a session starts.
//   2. the auto-mode classifier - a judgement on the action itself, made
//      server-side. Its refusal reasons ([Git Destructive], [Production
//      Deploy]) do not appear anywhere in the installed CLI binary, which is
//      how you can tell it is not local: no file in this repository can
//      pre-approve them. Only the session's permission mode turns that layer
//      off, and that is set where the session is created.
//
// So this screen composes the file that layer 1 actually reads, and says
// plainly that layer 2 is elsewhere. A screen that stored an allow list in
// Supabase and implied the dialogs would stop would be a placebo - the
// database has no channel to the harness - and a placebo here costs more than
// no screen at all, because the dialogs would keep coming and the list would
// look broken rather than absent.
export default function AdminClaudePage() {
  return (
    <main className="wrap" style={{ paddingTop: 32, paddingBottom: 96 }}>
      <span className="kicker">Admin</span>
      <h1 style={{ fontSize: 26, margin: "6px 0 4px" }}>Supabase permissions</h1>
      <p className="muted small" style={{ margin: "0 0 18px", maxWidth: 640 }}>
        Pick what should never be asked about again. This builds the file that
        carries the decision.
      </p>

      <div className="notice info" style={{ marginBottom: 18 }}>
        <div>
          <strong>Read this once, then you can ignore it.</strong>
          <p style={{ margin: "6px 0 0" }}>
            This page cannot switch the prompts off by itself, and no page here
            could. The permission decision is made by the Claude Code harness,
            in two separate places:
          </p>
          <p style={{ margin: "8px 0 0" }}>
            <strong>The allow list</strong> — what you build below. It lives in{" "}
            <code>.claude/settings.json</code> in the repository and is read{" "}
            <strong>once, when a session starts</strong>. Editing it mid-session
            changes nothing until the next one.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            <strong>The auto-mode classifier</strong> — a judgement on the
            action rather than the tool name. It is what produced the three
            Execute SQL dialogs, and it runs outside this repository entirely.
            No allow list reaches it.
          </p>
          <p style={{ margin: "8px 0 0" }}>
            <strong>The session&apos;s permission mode</strong> — the only
            thing that removes the classifier, and it is not set from any file
            we control here. Two limits are worth knowing before you try:
          </p>
          <ul style={{ margin: "6px 0 0", paddingLeft: 20 }}>
            <li>
              <strong>No environment variable sets it.</strong> Nothing you put
              in a cloud environment&apos;s variables box changes a permission
              mode — the documented variables cover none of this, and the CLI
              has no such variable.
            </li>
            <li>
              <code>permissions.defaultMode</code> in this repo&apos;s{" "}
              <code>.claude/settings.json</code> honours{" "}
              <code>default</code>, <code>acceptEdits</code> and{" "}
              <code>plan</code>, but <em>not</em> <code>auto</code> or{" "}
              <code>bypassPermissions</code> — those need user or managed
              settings.
            </li>
            <li>
              And <strong>cloud sessions ignore</strong>{" "}
              <code>bypassPermissions</code> and <code>dontAsk</code> from
              settings files altogether. On the web and the phone, the mode
              picker on the session is the lever; a file cannot do it.
            </li>
          </ul>
        </div>
      </div>

      <PermissionBuilder />
    </main>
  );
}
