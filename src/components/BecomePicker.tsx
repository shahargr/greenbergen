import { becomeUser } from "@/components/viewas";

export type BecomeGroup = { label: string; people: { id: string; name: string; hint?: string | null }[] };

// The god-mode picker: choose a person, then look through their eyes (view)
// or use their hands (act). Posts to becomeUser and returns to `back`.
export function BecomePicker({ groups, back }: { groups: BecomeGroup[]; back: string }) {
  const shown = groups.filter((g) => g.people.length > 0);
  if (shown.length === 0) return null;
  return (
    <form action={becomeUser} style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="back" value={back} />
      <select name="user" className="input" defaultValue="" required
        style={{ padding: "4px 8px", fontSize: 12, maxWidth: 240, background: "#fff", color: "var(--ink)" }}>
        <option value="" disabled>Become someone…</option>
        {shown.map((g) => (
          <optgroup key={g.label} label={g.label}>
            {g.people.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.hint ? ` · ${u.hint}` : ""}</option>
            ))}
          </optgroup>
        ))}
      </select>
      <button name="mode" value="view" className="btn small" style={{ background: "#fff", color: "#7a1f2b", border: 0 }}
        title="See the system through their eyes; changes refused">👁 View</button>
      <button name="mode" value="act" className="btn small" style={{ background: "#fff", color: "#7a1f2b", border: 0 }}
        title="Do things as them; every change is logged with your name behind it">⚡ Act</button>
    </form>
  );
}
