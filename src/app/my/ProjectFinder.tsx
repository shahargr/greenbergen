"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

// THE LANDING'S PROJECT GRID AND ITS SEARCH.
//
// Shahar, 2026-09-20: "remove all houses and projects from this landing page
// ... instead, leave just a 16x16 project page and search option to look for
// projects based on owner / address / type / contractor."
//
// The houses and the project rails moved to /my/houses and /my/projects. What
// stays here is a dense grid of small tiles and one box over it. I read
// "16x16" as small square tiles laid in a grid rather than a literal pixel
// size - 16px would be four characters wide and could not carry a name - and
// flagged the reading rather than guessing silently.
//
// THE FOUR FIELDS COME FROM THE DATABASE, NOT FROM THE PAGE. portal_home's
// overview has no owner and no contractor on it at all, so two of the four
// things you search by were never on the wire; portal_project_search
// (migration 201) resolves all four in one read.

export type FoundProject = {
  id: string;
  name: string;
  address: string | null;
  type: string;
  status: string;
  owner: string | null;
  contractor: string | null;
};

// A tile's colour says what kind of thing it is at a glance, the same four
// families the old rails used.
const TINT: Record<string, string> = {
  house: "var(--ok)",
  project: "var(--accent)",
  "real estate development": "#2f4f6b",
  system: "#6b5e2f",
};
const tintOf = (t: string) => TINT[t] ?? "var(--muted)";

const norm = (s: string) => s.toLowerCase().trim();

export function ProjectFinder({ projects }: { projects: FoundProject[] }) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = norm(q);
    if (!needle) return projects;
    // Every word has to land somewhere, so "jimmy tenafly" narrows rather
    // than widening the way a plain OR would.
    const words = needle.split(/\s+/);
    return projects.filter((p) => {
      const hay = norm([p.name, p.address ?? "", p.type, p.owner ?? "", p.contractor ?? ""].join(" · "));
      return words.every((w) => hay.includes(w));
    });
  }, [q, projects]);

  return (
    <section style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", margin: "0 0 8px" }}>
        <h2 className="section-title" style={{ margin: 0 }}>Projects · {shown.length}{shown.length !== projects.length ? ` of ${projects.length}` : ""}</h2>
        <Link href="/my/projects" className="small" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>See them all →</Link>
      </div>

      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by owner, address, type or contractor…"
        aria-label="Search projects by owner, address, type or contractor"
        style={{ width: "100%", marginBottom: 10 }}
      />

      {projects.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>Nothing to show yet.</p>
      )}
      {projects.length > 0 && shown.length === 0 && (
        <p className="muted small" style={{ margin: 0 }}>
          Nothing matches &ldquo;{q}&rdquo;. The box looks at the name, the address, the type,
          the owner and the contractor.
        </p>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 8 }}>
        {shown.map((p) => (
          <Link
            key={p.id}
            href={`/my/project/${p.id}`}
            className="card statlink"
            style={{
              padding: "10px 12px", display: "grid", gap: 2, minWidth: 0,
              borderLeft: `3px solid ${tintOf(p.type)}`,
            }}
            title={[p.name, p.address, p.owner && `Owner: ${p.owner}`, p.contractor && `Contractor: ${p.contractor}`]
              .filter(Boolean).join(" · ")}
          >
            <strong style={{ fontSize: 13, lineHeight: 1.25, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.name}
            </strong>
            <span className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {p.address ?? p.type}
            </span>
            {(p.owner || p.contractor) && (
              <span className="muted" style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p.contractor ?? p.owner}
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
