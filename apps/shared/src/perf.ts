// Server-side stopwatch. Every await that crosses the network gets wrapped
// in timed(); the numbers land in the platform log as one line per step:
//
//   [perf] /project me.claims=142ms
//
// and, where a response is available, as a Server-Timing header so the same
// numbers show up in the browser's network panel. Cheap enough to leave on:
// two Date.now() calls and a console.log per step.

export type Mark = { label: string; ms: number };

export async function timed<T>(label: string, fn: () => Promise<T>, marks?: Mark[]): Promise<T> {
  const t0 = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - t0;
    marks?.push({ label, ms });
    if (PERF_ON) console.log(`[perf] ${label}=${ms}ms`);
  }
}

// A whole page or request: prints the total and its parts on one line.
export function stopwatch(route: string) {
  const t0 = Date.now();
  const marks: Mark[] = [];
  return {
    marks,
    step: <T>(label: string, fn: () => Promise<T>) => timed(label, fn, marks),
    done() {
      const total = Date.now() - t0;
      if (PERF_ON) console.log(`[perf] ${route} total=${total}ms ${marks.map((m) => `${m.label}=${m.ms}ms`).join(" ")}`);
      return total;
    },
    header() {
      return [...marks.map((m) => `${m.label.replace(/[^\w]/g, "_")};dur=${m.ms}`), `total;dur=${Date.now() - t0}`].join(", ");
    },
  };
}

// On by default; set PERF_LOG=0 to silence it.
const PERF_ON = process.env.PERF_LOG !== "0";
