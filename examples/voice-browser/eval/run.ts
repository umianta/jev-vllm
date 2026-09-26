// Run the spoken-command cases against a live djev and score the verdicts.
//
//   DJEV_URL=http://localhost:8011 bun eval/run.ts
//   bun eval/run.ts --verbose      # print every answer, not just failures
import { Djev } from "../src/djev";
import { decide } from "../src/policy";
import type { Verdict } from "../src/types";
import { CASES, type Case } from "./cases";

const verbose = process.argv.includes("--verbose");
const samples = process.env.SAMPLES === "auto" ? "auto" : Number(process.env.SAMPLES ?? 1);
const djev = new Djev(process.env.DJEV_URL ?? "http://localhost:8011", process.env.MODEL ?? "diffusiongemma", samples);

function flatten(v: Verdict): Record<string, unknown> {
  const action = "action" in v ? v.action : {};
  return { type: v.type, ...action };
}

function check(c: Case, v: Verdict): string[] {
  const got = flatten(v);
  return Object.entries(c.expect)
    .filter(([k, want]) => got[k] !== want)
    .map(([k, want]) => `${k}: want ${JSON.stringify(want)}, got ${JSON.stringify(got[k])}`);
}

// Warm up (the first calls after a start are slow).
await djev.decide("go back", CASES[0].page, []);

let pass = 0;
const times: number[] = [];
for (const c of CASES) {
  const final = c.final ?? true;
  const { answers, ms } = await djev.decide(c.say, c.page, []);
  times.push(ms);
  const v = decide(answers, c.say, c.page, { final, silenceMs: final ? 1000 : 0 });
  const problems = check(c, v);
  if (!problems.length) pass++;
  const mark = problems.length ? "FAIL" : "ok  ";
  if (problems.length || verbose) {
    const t = answers.target ? ` target=${answers.target.choice}(${answers.target.confidence.toFixed(2)})` : "";
    console.log(`${mark} ${String(ms).padStart(4)} ms  "${c.say}"${final ? "" : " (mid-sentence)"}`);
    console.log(`       intent=${answers.intent.choice}(${answers.intent.confidence.toFixed(2)}) cmd=${answers.is_command.noul.toFixed(2)} complete=${answers.complete.noul.toFixed(2)} destructive=${answers.destructive.noul.toFixed(2)}${t}`);
    for (const p of problems) console.log(`       ${p}`);
  }
}

times.sort((a, b) => a - b);
const p = (q: number) => times[Math.min(times.length - 1, Math.floor(q * times.length))];
console.log(`\n${pass}/${CASES.length} cases pass · decision latency p50 ${p(0.5)} ms, p95 ${p(0.95)} ms`);
process.exit(pass === CASES.length ? 0 : 1);
