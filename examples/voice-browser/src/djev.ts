// Minimal client for djev's /v1/systemone.
import { buildQuestions, buildState } from "./questions";
import type { Answers, PageState } from "./types";

export interface DecideResult {
  answers: Answers;
  ms: number;
}

export class Djev {
  constructor(
    readonly url: string,
    readonly model = "diffusiongemma",
    readonly samples: number | "auto" = 1,
  ) {}

  async decide(transcript: string, page: PageState, recent: string[], signal?: AbortSignal): Promise<DecideResult> {
    const started = performance.now();
    const res = await fetch(`${this.url.replace(/\/$/, "")}/v1/systemone`, {
      method: "POST",
      // kubectl port-forward drops reused sockets, so don't keep them alive.
      headers: { "content-type": "application/json", connection: "close" },
      body: JSON.stringify({
        model: this.model,
        samples: this.samples,
        state: buildState(transcript, page, recent),
        questions: buildQuestions(page),
      }),
      signal,
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`djev ${res.status}: ${body?.error?.message ?? res.statusText}`);
    return { answers: body.answers as Answers, ms: Math.round(performance.now() - started) };
  }
}
