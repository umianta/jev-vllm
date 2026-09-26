// Smoke test for the DiffusionGemma endpoint: plain chat completion.
//   kubectl -n jev-vllm port-forward svc/diffusiongemma-jev-kserve-workload-svc 8000:8000 &
//   bun client/smoke.ts "Is the sky blue? Answer yes or no."
const base = process.env.VLLM_URL ?? "http://localhost:8000";
const prompt = process.argv[2] ?? "Is the sky blue? Answer yes or no.";

const res = await fetch(`${base}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "diffusiongemma",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 64,
  }),
});

if (!res.ok) {
  console.error(res.status, await res.text());
  process.exit(1);
}
const body = await res.json();
console.log(body.choices[0].message.content);
