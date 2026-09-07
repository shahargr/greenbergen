import { AppBar, Card, Screen, Skeleton } from "@shared/ui";

// E1 - skeleton with the shape of the real package page. Shown after
// 300 ms by the browser's own paint timing; never flashed on purpose.
export default function Loading() {
  return (
    <Screen>
      <AppBar back="/packages" title=" " />
      <div className="body">
        <div className="illus"><Skeleton h={120} w="70%" /></div>
        <Card pad>
          <Skeleton h={10} w={110} style={{ marginBottom: 12 }} />
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} h={14} w={`${90 - (i % 3) * 12}%`} style={{ margin: "10px 0" }} />)}
        </Card>
        <Card pad>
          <Skeleton h={10} w={160} />
          <Skeleton h={44} w={150} style={{ margin: "10px 0 6px" }} />
          <Skeleton h={12} w="60%" />
        </Card>
      </div>
    </Screen>
  );
}
