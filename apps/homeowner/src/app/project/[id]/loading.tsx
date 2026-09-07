import { AppBar, Blueprint, Screen, Skeleton } from "@shared/ui";

export default function Loading() {
  return (
    <Screen>
      <AppBar brand />
      <div className="body">
        <Skeleton h={10} w={140} />
        <Skeleton h={30} w="70%" />
        <Blueprint pad><div className="row"><Skeleton h={40} w={40} /><div className="grow"><Skeleton h={14} w="60%" /><Skeleton h={10} w="40%" style={{ marginTop: 6 }} /></div></div></Blueprint>
        <Blueprint pad><Skeleton h={54} /></Blueprint>
        <Blueprint pad><Skeleton h={10} w={100} /><Skeleton h={18} w="50%" style={{ margin: "8px 0" }} /><Skeleton h={12} /><Skeleton h={12} w="80%" style={{ marginTop: 6 }} /></Blueprint>
      </div>
    </Screen>
  );
}
