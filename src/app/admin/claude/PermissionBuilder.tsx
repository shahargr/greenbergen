"use client";

import { useMemo, useState } from "react";

// THE ALLOW LIST, AS THE FILE THAT ACTUALLY CARRIES IT.
//
// Shahar, 2026-09-20: "Build a screen that allows me to set my own
// permissions while working with Supabase ... an allow list of APIs calls
// with pre-approved rights so Claude does not need to pause asking me."
//
// This screen composes `.claude/settings.json`. It does NOT enforce anything,
// and pretending otherwise would be the worst thing it could do - see the
// panel this renders above itself. Claude Code reads that file out of the
// repository when a session STARTS; nothing this app writes to Supabase is on
// that path, because the dialog is drawn by the agent harness and not by us.
//
// So: tick what should never be asked about again, copy the file, commit it,
// start a fresh session. Three of those four steps are a person's; the screen
// does the one it can do properly.

type Tool = { name: string; label: string; what: string };

// Every Supabase MCP tool, split by what it can actually do to the project.
// The split is the point: "allow Supabase" as one blob is how you end up
// pre-approving delete_branch because you were tired of approving select.
const READS: Tool[] = [
  { name: "execute_sql", label: "Execute SQL", what: "Runs a query. Also the one that writes rows - it is not read-only." },
  { name: "list_tables", label: "List tables", what: "Names, columns, constraints." },
  { name: "list_migrations", label: "List migrations", what: "What has been applied." },
  { name: "list_extensions", label: "List extensions", what: "Installed Postgres extensions." },
  { name: "get_advisors", label: "Get advisors", what: "Security and performance warnings." },
  { name: "query_logs", label: "Query logs", what: "Recent Postgres, API and auth logs." },
  { name: "get_project", label: "Get project", what: "Status, region, created date." },
  { name: "get_project_url", label: "Get project URL", what: "The API URL." },
  { name: "get_publishable_keys", label: "Get publishable keys", what: "The anon key. Publishable by design." },
  { name: "list_edge_functions", label: "List edge functions", what: "Slugs, versions, verify_jwt." },
  { name: "get_edge_function", label: "Get edge function", what: "One function's source." },
  { name: "generate_typescript_types", label: "Generate types", what: "Types from the live schema." },
  { name: "search_docs", label: "Search docs", what: "Supabase's own documentation." },
];

const WRITES: Tool[] = [
  { name: "apply_migration", label: "Apply migration", what: "A named, recorded DDL change. The normal way this project is built." },
  { name: "deploy_edge_function", label: "Deploy edge function", what: "Replaces live function code. Can flip verify_jwt." },
];

const HEAVY: Tool[] = [
  { name: "create_branch", label: "Create branch", what: "A new database branch. Costs money." },
  { name: "delete_branch", label: "Delete branch", what: "Destroys a branch." },
  { name: "merge_branch", label: "Merge branch", what: "Pushes a branch's migrations to production." },
  { name: "reset_branch", label: "Reset branch", what: "Throws away a branch's data." },
  { name: "rebase_branch", label: "Rebase branch", what: "Rewrites a branch onto production." },
  { name: "create_project", label: "Create project", what: "A whole new Supabase project." },
  { name: "pause_project", label: "Pause project", what: "Takes the database offline." },
  { name: "restore_project", label: "Restore project", what: "Brings a paused project back." },
];

// The sentences that go in autoMode.allow. These are read by the classifier,
// not matched as patterns, so they are written as a person would explain the
// situation to somebody standing behind them.
const SENTENCES: { id: string; text: string; why: string }[] = [
  {
    id: "db",
    text: "Reading and writing the Green Bergen Supabase project (ref oznqiwldgjrykadqsriv) with the Supabase MCP tools, including execute_sql and apply_migration. This is the owner's own database and schema migrations are the normal way this project is built.",
    why: "The one that covers the dialogs you are seeing.",
  },
  {
    id: "branch",
    text: "Pushing commits to the working branch of shahargr/greenbergen and fast-forwarding main to it, because this repository has one author and the branch is the delivery path.",
    why: "Stops the [Git Destructive] and [Production Deploy] refusals on push.",
  },
  {
    id: "build",
    text: "Running the repository's own checks without asking: npm install, next build, tsc --noEmit, eslint, and the app's dev server.",
    why: "Verification before a push, which is the thing that keeps CI green.",
  },
];

const FENCE = "`";

// Module-level, not made inside PermissionBuilder: a component declared during
// render is a new type on every render, so React unmounts the whole group and
// the checkbox you just clicked loses focus.
function Group({ title, lead, tools, list, onToggle }: {
  title: string; lead: string; tools: Tool[]; list: string[]; onToggle: (name: string) => void;
}) {
  return (
    <div className="card" style={{ display: "grid", gap: 8 }}>
      <h2 className="section-title" style={{ margin: 0 }}>{title}</h2>
      <p className="muted small" style={{ margin: 0 }}>{lead}</p>
      <div style={{ display: "grid", gap: 6, marginTop: 4 }}>
        {tools.map((t) => (
          <label key={t.name} style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.35 }}>
            <input type="checkbox" checked={list.includes(t.name)} onChange={() => onToggle(t.name)}
              style={{ marginTop: 3, flex: "none" }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 600 }}>{t.label}</span>{" "}
              <code className="small" style={{ opacity: 0.7 }}>{t.name}</code>
              <span className="muted small" style={{ display: "block" }}>{t.what}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

export function PermissionBuilder() {
  // Defaults mirror what .claude/settings.json holds today: the whole Supabase
  // surface allowed, the project-level tools pulled back out into "ask".
  const [reads, setReads] = useState<string[]>(READS.map((t) => t.name));
  const [writes, setWrites] = useState<string[]>(["apply_migration"]);
  const [heavy, setHeavy] = useState<string[]>([]);
  const [sentences, setSentences] = useState<string[]>(["db"]);
  const [copied, setCopied] = useState(false);

  const toggle = (list: string[], set: (v: string[]) => void, name: string) =>
    set(list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);

  const json = useMemo(() => {
    const allowed = [...reads, ...writes, ...heavy];
    const asked = [...READS, ...WRITES, ...HEAVY]
      .map((t) => t.name)
      .filter((nm) => !allowed.includes(nm));
    const settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      permissions: {
        allow: allowed.map((nm) => `mcp__Supabase__${nm}`),
        ...(asked.length ? { ask: asked.map((nm) => `mcp__Supabase__${nm}`) } : {}),
      },
      autoMode: {
        allow: ["$defaults", ...SENTENCES.filter((s) => sentences.includes(s.id)).map((s) => s.text)],
      },
    };
    return JSON.stringify(settings, null, 2);
  }, [reads, writes, heavy, sentences]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <Group title="Reading, and querying" list={reads} onToggle={(nm) => toggle(reads, setReads, nm)} tools={READS}
        lead="Safe to pre-approve as a group, with one exception worth reading: execute_sql also writes." />
      <Group title="Changing the schema and the functions" list={writes} onToggle={(nm) => toggle(writes, setWrites, nm)} tools={WRITES}
        lead="These change what is live. Pre-approve the ones that are your normal way of working." />
      <Group title="Whole-project and branch operations" list={heavy} onToggle={(nm) => toggle(heavy, setHeavy, nm)} tools={HEAVY}
        lead="Expensive, destructive, or both. Left unticked they land in ask, which is where they belong." />

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>Standing explanations</h2>
        <p className="muted small" style={{ margin: 0 }}>
          The auto-mode classifier does not match tool names — it reads a
          situation. These are the sentences it reads, so they are written the
          way you would explain it to somebody standing behind you.
        </p>
        <div style={{ display: "grid", gap: 8, marginTop: 4 }}>
          {SENTENCES.map((s) => (
            <label key={s.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.35 }}>
              <input type="checkbox" checked={sentences.includes(s.id)}
                onChange={() => toggle(sentences, setSentences, s.id)} style={{ marginTop: 3, flex: "none" }} />
              <span style={{ minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{s.why}</span>
                <span className="muted small" style={{ display: "block" }}>{s.text}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="card" style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h2 className="section-title" style={{ margin: 0 }}>
            <code>.claude/settings.json</code>
          </h2>
          <button type="button" className="btn small" onClick={copy}>
            {copied ? "Copied" : "Copy the file"}
          </button>
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Replace the file at the repository root with this, commit it, and
          start a <strong>new</strong> session. Not a restarted container — a
          restart resumes the same session and keeps the permission config it
          started with.
        </p>
        <pre className="small" style={{
          margin: 0, padding: "12px 14px", borderRadius: 10, overflowX: "auto",
          background: "var(--card-2, rgba(0,0,0,0.04))", lineHeight: 1.45,
        }}><code>{json}</code></pre>
        <p className="muted small" style={{ margin: 0 }}>
          Paths are checked against the tool name, so {FENCE}mcp__Supabase{FENCE} on
          its own would cover every tool above, including the branch ones. The
          list is written out in full here on purpose.
        </p>
      </div>
    </>
  );
}
