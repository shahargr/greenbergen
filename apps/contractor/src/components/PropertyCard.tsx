import Link from "next/link";
import { money, runs, type Node } from "@/lib/board";

// A property on the board, with its face on it.
//
// The board's job is to answer "where is the work" before "what is the
// work", and nothing answers that faster than the picture of the house. The
// numbers underneath are rolled up from everything beneath the property
// (buildTree does that), so a panel is honest about the whole site and not
// just the container row.
//
// The whole panel is the link. A person aiming at a house on a phone should
// not have to find a chevron.
export function PropertyCard({ node, url }: { node: Node; url: string | null }) {
  const s = node.seat;
  const owed = money(node.owed);
  return (
    <Link href={`/project/${s.project_id}`} className="prop">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="shot" src={url} alt="" />
      ) : (
        <span className="shot empty" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" />
          </svg>
        </span>
      )}
      <span className="body">
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="t">{s.project_name}</span>
          <span className="m">
            {[s.address?.split(",").slice(1).join(",").trim() || s.address, s.stage, runs(s) ? "you run this" : s.seat]
              .filter(Boolean).join(" · ")}
          </span>
          <span className="stats">
            {node.count > 0 && <span className="tag tag-neutral">{node.count} {node.count === 1 ? "job" : "jobs"}</span>}
            {node.open > 0 && <span className="tag tag-outline">{node.open} open</span>}
            {node.mine > 0 && <span className="tag tag-status">{node.mine} yours</span>}
            {owed && <span className="tag tag-neutral">{owed} owed</span>}
            {node.count === 0 && node.open === 0 && !owed && <span className="tag tag-neutral">nothing open</span>}
          </span>
        </span>
      </span>
    </Link>
  );
}
