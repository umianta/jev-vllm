// Latency/throughput bench for djev /v1/systemone.
//   kubectl -n jev-vllm port-forward svc/djev 8011:8011 &
//   bun client/bench.ts            # DJEV_URL overrides the base URL
const base = process.env.DJEV_URL ?? "http://localhost:8011";

const tickets = [
  "Everything is down and we have a demo at noon.",
  "Can you send me last month's invoice?",
  "Thanks, the fix worked perfectly.",
  "I was charged twice and want a refund today.",
];

const body = (i: number, extra: Record<string, unknown> = {}) => ({
  model: "diffusiongemma",
  state: { ticket: tickets[i % tickets.length] },
  questions: {
    urgent: { type: "noul", instructions: "Does the customer need a reply within the hour?" },
  },
  ...extra,
});

async function call(i: number, extra: Record<string, unknown>): Promise<number> {
  const t0 = performance.now();
  const res = await fetch(`${base}/v1/systemone`, {
    method: "POST",
    // kubectl port-forward drops reused keep-alive sockets (ECONNRESET)
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body(i, extra)),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  await res.json();
  return performance.now() - t0;
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

async function sequential(label: string, extra: Record<string, unknown>, n = 20) {
  const ms: number[] = [];
  for (let i = 0; i < n; i++) ms.push(await call(i, extra));
  console.log(
    `${label.padEnd(28)} seq n=${n}  p50=${pct(ms, 50).toFixed(0)}ms  p95=${pct(ms, 95).toFixed(0)}ms  min=${Math.min(...ms).toFixed(0)}ms`,
  );
}

async function concurrent(label: string, extra: Record<string, unknown>, conc: number, total: number) {
  let next = 0;
  const ms: number[] = [];
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: conc }, async () => {
      while (next < total) ms.push(await call(next++, extra));
    }),
  );
  const secs = (performance.now() - t0) / 1000;
  console.log(
    `${label.padEnd(28)} conc=${String(conc).padEnd(2)} n=${total}  ${(total / secs).toFixed(1)} decisions/s  p50=${pct(ms, 50).toFixed(0)}ms  p95=${pct(ms, 95).toFixed(0)}ms`,
  );
}

for (let i = 0; i < 4; i++) await call(i, {}); // warmup
await sequential("default (auto samples)", {});
await sequential("samples=1", { samples: 1 });
await concurrent("default (auto samples)", {}, 8, 64);
await concurrent("samples=1", { samples: 1 }, 8, 64);
await concurrent("samples=1", { samples: 1 }, 32, 128);
