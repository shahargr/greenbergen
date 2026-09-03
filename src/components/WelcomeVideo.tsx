// Renders the admin-set welcome video: YouTube links become embeds,
// anything else plays as a plain video file.
export function WelcomeVideo({ url }: { url: string }) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) {
    return (
      <div style={{ position: "relative", paddingTop: "56.25%", borderRadius: 12, overflow: "hidden" }}>
        <iframe
          src={`https://www.youtube.com/embed/${yt[1]}`}
          title="Welcome to greenbergen"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      </div>
    );
  }
  return <video controls preload="metadata" src={url} style={{ width: "100%", borderRadius: 12 }} />;
}
