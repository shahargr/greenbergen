"use client";

import { useEffect, useState } from "react";
import { createClient } from "@shared/supabase/client";

// WHO DOES THIS TRADE? (migration 188c)
//
// Shahar (2026-09-18): "when adding someone to the bid room, search all
// contacts for that particular trade required. note that some jobs may have 2
// trades or more, so account for it."
//
// The room used to offer two things, neither of them this: a free-text box
// for somebody brand new, and a tick list of everybody holding a seat on the
// project - which on a real job is the surveyor, the insurance broker and the
// portable toilet company. The roofer you have used twice was not on it
// unless he happened to be a member.
//
// So: the trade is the question. contact_trade_roles is where the answer
// lives, and the room has been writing to it every time somebody is added by
// hand, so the list gets better the more it is used. Best-known first, by how
// often we have put them in a room before.
//
// TWO TRADES, OR FIVE. A room is opened on one trade but a job needs several,
// and the person standing in the roofing room often wants the plumber they
// just met - so the job's other trades are chips across the top, and picking
// one searches it without leaving the room.
type Person = {
  contact_id: string; company_id: string | null; name: string; company: string | null;
  phone: string | null; email: string | null; trades: string[];
  does_this_trade: boolean; bids_with_us: number; in_room: boolean;
};
type Answer = { room_trade: string | null; searching: string | null; job_trades: string[]; people: Person[] };

export function RoomPeople({ pkgId, roomTrade, action }: {
  pkgId: string;
  roomTrade: string | null;
  action: (formData: FormData) => void;
}) {
  const [trade, setTrade] = useState<string | null>(roomTrade);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  // Starts true: the first read is already on its way when this mounts, and
  // "nobody does this trade" flashing before the answer arrives is a lie.
  const [busy, setBusy] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);

  // ONE READ PER QUESTION, and the question is the state: which trade, and
  // what was typed. The handlers below only change those - the reading is
  // this effect's job, which is what keeps a fast typist from racing their
  // own results (the last answer in wins, and `cancelled` drops the rest).
  //
  // A name search reaches every contact and ignores the trade, because you
  // are often standing in front of somebody whose trade nobody has recorded
  // yet - our own bookkeeping must not hide a real person.
  useEffect(() => {
    let cancelled = false;
    const typed = q.trim();
    // A pause before searching a name; a chip is instant, because it is a
    // decision rather than a keystroke.
    const wait = typed ? 250 : 0;
    const timer = setTimeout(() => {
      void (async () => {
        const { data } = await createClient().rpc("portal_bid_room_people", {
          p_package: pkgId, p_q: typed || null, p_trade: trade,
        });
        if (cancelled) return;
        setAnswer((data ?? null) as Answer | null);
        setBusy(false);
      })();
    }, wait);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [pkgId, trade, q]);

  const others = (answer?.job_trades ?? []).filter((t) => t !== roomTrade);
  const people = answer?.people ?? [];
  const free = people.filter((p) => !p.in_room);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {roomTrade && (
          <button type="button" className={`tag ${trade === roomTrade && !q ? "tag-accent" : "tag-outline"}`}
            onClick={() => { setBusy(true); setTrade(roomTrade); setQ(""); }}>
            {roomTrade}
          </button>
        )}
        {others.map((t) => (
          <button key={t} type="button" className={`tag ${trade === t && !q ? "tag-accent" : "tag-outline"}`}
            onClick={() => { setBusy(true); setTrade(t); setQ(""); }}>
            {t}
          </button>
        ))}
      </div>

      <label className="field" style={{ marginBottom: 0 }}>
        <span className="field-label">Or search every contact by name</span>
        <input className="input" value={q} placeholder="Diego · Paese · Guicho"
          onChange={(e) => { setBusy(true); setQ(e.target.value); }} />
      </label>

      {busy && <p className="tiny text-muted" style={{ margin: 0 }}>Looking…</p>}

      {!busy && people.length === 0 && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          {q
            ? `Nobody called "${q}". Put them in by hand below — it makes the contact as it goes.`
            : `Nobody on file does ${trade ?? "this trade"} yet. Put the first one in by hand below and they are on the list from then on.`}
        </p>
      )}

      {free.length > 0 && (
        <form action={action} className="stack" style={{ gap: 6 }}>
          <div className="bucket-rows">
            {free.map((p) => (
              <label key={p.contact_id} className="radio-opt" style={{ marginBottom: 0 }}>
                <input type="checkbox" name="contact" value={p.contact_id}
                  checked={picked.includes(p.contact_id)}
                  onChange={(e) => setPicked(e.target.checked
                    ? [...picked, p.contact_id]
                    : picked.filter((x) => x !== p.contact_id))} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="t">{p.company ?? p.name}</span>
                  <span className="m" style={{ display: "block" }}>
                    {[
                      p.company && p.name !== p.company ? p.name : null,
                      p.trades.length > 0 ? p.trades.join(", ") : "no trade on file",
                      p.bids_with_us > 0
                        ? `${p.bids_with_us} bid${p.bids_with_us === 1 ? "" : "s"} with us`
                        : "never bid with us",
                      p.phone,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <button className="btn btn-primary btn-block" disabled={picked.length === 0}>
            {picked.length === 0
              ? "Pick somebody"
              : `Put ${picked.length} ${picked.length === 1 ? "person" : "people"} in the room`}
          </button>
        </form>
      )}

      {people.length > free.length && (
        <p className="tiny text-muted" style={{ margin: 0 }}>
          {people.length - free.length} of them {people.length - free.length === 1 ? "is" : "are"} already in this room.
        </p>
      )}
    </div>
  );
}
