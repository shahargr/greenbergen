import { AppBar, Card, Screen, Skeleton } from "./ui";

// WHILE A SCREEN IS BEING BUILT (Shahar, 2026-09-19: "since it takes time for
// the page to load I would like you to show me a progress bar or hour glass,
// something ... maybe fast landing while rest is loaded?").
//
// WHAT WAS ACTUALLY WRONG. Ninety-odd screens across three apps and three
// loading.tsx files between them. Without one, Next has nothing to show while
// the server builds a page, so it holds the OLD screen on the glass - you tap
// a project, nothing happens, you tap again. The wait was never the problem;
// the silence was.
//
// A loading.tsx at the root of an app covers every screen under it, so one
// file per app turns every navigation in that app instant: the bar appears,
// the shape of the page appears, and the real thing streams in over it. A
// screen whose shape is worth drawing properly still overrides it with its
// own - the packages grid and a project already do.
//
// SKELETONS, NOT A SPINNER. The house rule since the packages grid: keep the
// shape, so the page does not jump when it arrives. The bar across the top is
// the one exception, and it is there because a skeleton alone does not say
// "something is happening RIGHT NOW" - which, tapping a link twice, is the
// only question being asked.
export function LoadingBar() {
  // Indeterminate on purpose. A percentage would be a lie: the server does
  // not tell the browser how far through it is, and a fake bar that stalls at
  // 90% is worse than an honest one that keeps moving.
  return <div className="load-bar" role="progressbar" aria-label="Loading" aria-busy="true"><span /></div>;
}

export function LoadingScreen({ title, bar = true }: {
  /** A name for what is coming, when the route knows it. */
  title?: string;
  bar?: boolean;
}) {
  return (
    <Screen>
      {bar && <LoadingBar />}
      <AppBar brand title={title} />
      <div className="body">
        <Skeleton h={10} w={120} />
        <Skeleton h={28} w="65%" />
        <Card pad>
          <div className="row" style={{ gap: 10 }}>
            <Skeleton h={40} w={40} />
            <div className="grow">
              <Skeleton h={14} w="60%" />
              <Skeleton h={10} w="40%" style={{ marginTop: 6 }} />
            </div>
          </div>
        </Card>
        <Card pad><Skeleton h={48} /></Card>
        <Card pad>
          <Skeleton h={10} w={100} />
          <Skeleton h={18} w="50%" style={{ margin: "8px 0" }} />
          <Skeleton h={12} />
          <Skeleton h={12} w="80%" style={{ marginTop: 6 }} />
        </Card>
      </div>
    </Screen>
  );
}
