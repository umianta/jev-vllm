// Record real request/response pairs and timings from a live djev for the video.
// The video renders only from video-data.json, so every payload and number in it is real.
//
//   DJEV_URL=http://localhost:8011 bun capture.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildQuestions, buildState } from "../../examples/voice-browser/src/questions";
import { YOUTUBE } from "../../examples/voice-browser/eval/fixtures";
import payload3 from "../../client/payloads/3-multi-depends.json";

const BASE = process.env.DJEV_URL ?? "http://localhost:8011";
const RUNS = 7;

async function post(path: string, body: unknown) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", connection: "close" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, ms: performance.now() - t0, json };
}

/** Median of RUNS calls; keeps the response from the median run. */
async function measure(path: string, body: unknown) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) runs.push(await post(path, body));
  runs.sort((a, b) => a.ms - b.ms);
  const mid = runs[Math.floor(runs.length / 2)];
  const { diagnostics: _drop, ...rest } = mid.json as Record<string, unknown>; // long internals; not shown
  return { status: mid.status, ms: Math.round(mid.ms), response: rest };
}

const simple = {
  model: "diffusiongemma",
  samples: 1,
  state: { ticket: "Everything is down and we have a demo at noon." },
  questions: { urgent: { type: "noul", instructions: "Does the customer need a reply within the hour?" } },
};
const multi = { ...payload3, samples: 1 };
const voice = {
  model: "diffusiongemma",
  samples: 1,
  state: buildState("play the one about transformers", YOUTUBE, []),
  questions: buildQuestions(YOUTUBE),
};
const chat = {
  model: "diffusiongemma",
  messages: [{ role: "user", content: `Ticket: "${simple.state.ticket}" Does the customer need a reply within the hour? Answer yes or no.` }],
  max_tokens: 16,
};

await post("/v1/systemone", simple); // warm up
const data = {
  capturedAt: new Date().toISOString(),
  endpoint: `${BASE.replace(/\/\/[\d.]+:/, "//localhost:")}/v1/systemone`,
  simple: { request: simple, ...(await measure("/v1/systemone", simple)) },
  multi: { request: multi, ...(await measure("/v1/systemone", multi)) },
  voice: { request: voice, ...(await measure("/v1/systemone", voice)) },
  chat: { request: chat, ...(await measure("/v1/raw/chat/completions", chat)) },
};
writeFileSync(join(import.meta.dir, "video-data.json"), `${JSON.stringify(data, null, 2)}\n`);
for (const k of ["simple", "multi", "voice", "chat"] as const) console.log(k, data[k].status, `${data[k].ms} ms`);
