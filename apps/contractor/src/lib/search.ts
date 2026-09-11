// The search test, in a module with no "use client" on it.
//
// It used to live in SearchBox.tsx, which is a client component - and a
// function exported from a client module cannot be CALLED on the server, only
// rendered or passed as a prop. Both screens that search are server
// components, so every search threw:
//
//   Attempted to call matchesQuery() from the server but matchesQuery is on
//   the client.
//
// The project screen only ran the filter when something was typed, so the
// page worked until you typed - which is exactly how Shahar found it
// (2026-09-11, "typing jimmy, it crashes"). Here it is plain shared code,
// importable from either side.
export const matchesQuery = (q: string, fields: (string | null | undefined)[]) => {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const words = needle.split(/\s+/);
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return words.every((w) => hay.includes(w));
};
