export const dollars = (cents: number | null | undefined, opts: { sign?: boolean } = {}) => {
  if (cents == null) return "";
  const v = Math.round(cents / 100);
  const s = `$${Math.abs(v).toLocaleString("en-US")}`;
  if (opts.sign) return v < 0 ? `−${s}` : `+${s}`;
  return v < 0 ? `−${s}` : s;
};

export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }) : "";

export const shortDay = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

export const clock = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";

export const dayClock = (iso: string | null | undefined) =>
  iso ? `${new Date(iso).toLocaleDateString("en-US", { weekday: "short" })} ${clock(iso)}` : "";

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))} min ago`;
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  return `${Math.floor(h / 24)} days ago`;
};

export const initials = (name: string | null | undefined) =>
  (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "GB";

export const firstName = (name: string | null | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

// "Marta F." - what a shared card shows.
export const shortName = (name: string | null | undefined) => {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "A neighbor";
  if (parts.length === 1) return parts[0]!;
  return `${parts[0]} ${parts[parts.length - 1]![0]}.`;
};

export const townOf = (address: string | null | undefined) => {
  if (!address) return null;
  const parts = address.split(",").map((s) => s.trim());
  return parts.length >= 2 ? parts[1]!.replace(/\s+NJ.*$/i, "") : null;
};
