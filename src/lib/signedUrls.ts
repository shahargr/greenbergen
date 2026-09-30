import type { SupabaseClient } from "@supabase/supabase-js";

// One storage round trip per bucket instead of one per file. A page that
// shows twenty attachments used to pay twenty ~190 ms calls; the batch
// endpoint signs them all in one. Paths that fail to sign are left out, so
// a caller reads the map the same way it read the per-file result: no
// entry, no link.
export async function signedUrlMap(
  supabase: SupabaseClient,
  files: { bucket: string | null | undefined; path: string | null | undefined }[],
  ttl = 3600,
): Promise<Map<string, string>> {
  const byBucket = new Map<string, string[]>();
  for (const f of files) {
    if (!f.bucket || !f.path) continue;
    const list = byBucket.get(f.bucket) ?? [];
    if (!list.includes(f.path)) list.push(f.path);
    byBucket.set(f.bucket, list);
  }
  const out = new Map<string, string>();
  await Promise.all([...byBucket].map(async ([bucket, paths]) => {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(paths, ttl);
    for (const d of data ?? []) {
      if (d.path && d.signedUrl && !d.error) out.set(signedKey(bucket, d.path), d.signedUrl);
    }
  }));
  return out;
}

// The map's key: bucket and path together, since a path is only unique
// within its bucket.
export const signedKey = (bucket: string, path: string) => `${bucket}/${path}`;
