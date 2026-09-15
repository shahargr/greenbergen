import Link from "next/link";
import { money, seatLabel, type Node } from "@/lib/board";

// A PROPERTY AS A LINE, NOT A POSTER.
//
// Shahar (2026-09-14): "i am still not interested to see category with image
// : Greenbergen - it eats too much realestate. instead, start with Greenbergen
// project as a panel with all that sits on it... Next to it show my role on
// the project."
//
// PropertyCard gives a house half a screen, which is right when there are two
// and wrong when there are five and a development above them. This is the
// same information at a fifth of the height: the face survives as a 52px
// thumbnail (the board still answers "where" before "what", and a person
// recognises their own house at any size), the roll-up stays, and the seat
// moves to the right where it can be read down the column.
//
// The seat's word comes from seatLabel in lib/board, which is the one place
// that knows "owner" means co-owner next to somebody else's house.
export function PropertyRow({ node, url }: { node: Node; url: string | null }) {
  const s = node.seat;
  const role = seatLabel(s);
  // The town, not the street: the street is the row's own name half the time.
  const where = s.address?.split(",").slice(1).join(",").trim() || s.address;
  const owed = money(node.owed);
  return (
    <Link href={`/project/${s.project_id}`} className="home-row">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="pic" src={url} alt="" />
      ) : (
        <span className="pic empty" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10" />
          </svg>
        </span>
      )}
      <span className="grow" style={{ minWidth: 0 }}>
        <span className="t">{s.project_name}</span>
        <span className="m" style={{ display: "block" }}>
          {[
            where,
            node.count > 0 ? `${node.count} ${node.count === 1 ? "job" : "jobs"}` : null,
            node.open > 0 ? `${node.open} open` : null,
            node.mine > 0 ? `${node.mine} yours` : null,
            owed ? `${owed} owed` : null,
            node.count === 0 && node.open === 0 && !owed ? "nothing open" : null,
          ].filter(Boolean).join(" · ")}
        </span>
      </span>
      {role && (
        <span className="tag tag-neutral" style={{ flex: "none" }}>{role}</span>
      )}
    </Link>
  );
}
