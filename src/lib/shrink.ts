// RESIZED BEFORE IT LEAVES THE BROWSER.
//
// Public pages draw these photographs on a phone; a 3 MB original is the
// slowest thing on the screen (see the weekly site speed task). Long edge
// 1600 px, JPEG at 0.82 - a few hundred kilobytes for a photograph that size.
// If the browser cannot decode the file (some HEIC), the original goes up as
// it is rather than nothing.
//
// Shared by every Admin uploader that writes to public-media, so a landing
// photo and a package photo are treated the same way.
const LONG_EDGE = 1600;

export async function shrink(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.82));
    if (!blob) throw new Error("no blob");
    return { blob, ext: ".jpg", type: "image/jpeg" };
  } catch {
    const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] ?? ".jpg").toLowerCase();
    return { blob: file, ext, type: file.type || "image/jpeg" };
  }
}
