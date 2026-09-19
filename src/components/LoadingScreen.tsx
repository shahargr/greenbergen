// WHILE A SCREEN IS BEING BUILT (Shahar, 2026-09-19: "since it takes time for
// the page to load I would like you to show me a progress bar or hour glass").
//
// The portal does not compile apps/ (see CLAUDE.md), so it has its own copy of
// what the three apps share - the same bar and the same rule: keep the shape,
// never a spinner, and say plainly that something is happening now.
//
// A loading.tsx at the root of /app covers every screen in the portal, which
// is what makes a tap land instantly: Next swaps this in the moment you
// navigate, rather than holding the old screen on the glass while the server
// works.
export function LoadingBar() {
  // Indeterminate on purpose: the server never tells the browser how far
  // through it is, and a bar that stalls at 90% is worse than one that moves.
  return <div className="load-bar" role="progressbar" aria-label="Loading" aria-busy="true"><span /></div>;
}

const Skel = ({ h = 14, w = "100%", mt = 0 }: { h?: number; w?: string | number; mt?: number }) => (
  <div className="skel" style={{ height: h, width: w, marginTop: mt }} aria-hidden />
);

export function LoadingScreen() {
  return (
    <>
      <LoadingBar />
      <div className="wrap" style={{ paddingTop: 28, paddingBottom: 40, display: "grid", gap: 14 }}>
        <Skel h={10} w={120} />
        <Skel h={28} w="55%" />
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <Skel h={14} w="45%" />
          <Skel h={10} w="30%" />
          <Skel h={44} mt={6} />
        </div>
        <div className="card" style={{ display: "grid", gap: 8 }}>
          <Skel h={12} w="60%" />
          <Skel h={12} w="80%" />
          <Skel h={12} w="40%" />
        </div>
      </div>
    </>
  );
}
