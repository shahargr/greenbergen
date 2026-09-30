import type { SupabaseClient } from "@supabase/supabase-js";

// SIGNED URLS, ONE ROUND TRIP PER BUCKET. A screen with thirty photographs
// used to make thirty createSignedUrl calls at ~190 ms each; createSignedUrls
// signs a whole list in one, so the cost is the number of buckets, which is
// almost always one. Keyed by file id, which is what the screens draw by.
export async function signAll(
  supabase: SupabaseClient,
  files: { file_id: string; bucket: string; path: string }[],
  ttl = 3600,
): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const byBucket = new Map<string, { file_id: string; path: string }[]>();
  for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f]);
  await Promise.all([...byBucket.entries()].map(async ([bucket, list]) => {
    const { data } = await supabase.storage.from(bucket).createSignedUrls(list.map((f) => f.path), ttl);
    const byPath = new Map<string, string>();
    for (const row of data ?? []) if (row.path && row.signedUrl) byPath.set(row.path, row.signedUrl);
    for (const f of list) { const u = byPath.get(f.path); if (u) urls.set(f.file_id, u); }
  }));
  return urls;
}
