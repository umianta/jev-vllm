import { describe, expect, test } from "bun:test";
import { YOUTUBE } from "../eval/fixtures";
import { decide } from "../src/policy";
import type { Answers } from "../src/types";

function answers(over: Partial<Record<keyof Answers, unknown>> = {}): Answers {
  const choice = (c: string, p = 0.95) => ({ type: "choice", choice: c, confidence: p, probabilities: { [c]: p } });
  return {
    is_command: { type: "noul", noul: 0.99 },
    complete: { type: "noul", noul: 0.99 },
    intent: choice("click"),
    target: choice("k"),
    destructive: { type: "noul", noul: 0.01 },
    scroll_dir: choice("down"),
    scroll_amount: { type: "score", score: 1, legend: ["little", "page", "end"], probabilities: {}, confidence: 0.9 },
    tab_which: choice("next"),
    is_correction: { type: "noul", noul: 0.01 },
    ...over,
  } as Answers;
}

const talking = { final: false, silenceMs: 0 };
const paused = { final: true, silenceMs: 800 };

describe("policy", () => {
  test("confident complete click acts mid-sentence", () => {
    const v = decide(answers(), "click the rust video", YOUTUBE, talking);
    expect(v).toMatchObject({ type: "act", action: { kind: "click", id: "k" } });
  });

  test("not a command: wait while talking, ignore after", () => {
    const a = answers({ is_command: { type: "noul", noul: 0.1 } });
    expect(decide(a, "honey did you feed the cat", YOUTUBE, talking).type).toBe("wait");
    expect(decide(a, "honey did you feed the cat", YOUTUBE, paused).type).toBe("ignore");
  });

  test("incomplete command waits until the speaker pauses", () => {
    const a = answers({ complete: { type: "noul", noul: 0.2 } });
    expect(decide(a, "click the", YOUTUBE, talking).type).toBe("wait");
  });

  test("low intent confidence waits", () => {
    const a = answers({ intent: { type: "choice", choice: "click", confidence: 0.4, probabilities: {} } });
    expect(decide(a, "uh the", YOUTUBE, paused).type).toBe("wait");
  });

  test("search waits for the text to finish, then opens the site search", () => {
    const a = answers({ intent: { type: "choice", choice: "search", confidence: 0.99, probabilities: {} } });
    expect(decide(a, "search for lofi", YOUTUBE, talking).type).toBe("wait");
    const v = decide(a, "search for lofi music", YOUTUBE, paused);
    expect(v).toMatchObject({ type: "act", action: { kind: "open", url: "https://www.youtube.com/results?search_query=lofi%20music" } });
  });

  test("unsure target shows candidates", () => {
    const a = answers({
      target: { type: "choice", choice: "g", confidence: 0.4, probabilities: { g: 0.4, h: 0.35, k: 0.1 } },
    });
    expect(decide(a, "click the video", YOUTUBE, paused)).toMatchObject({ type: "disambiguate", candidates: ["g", "h"] });
  });

  test("destructive actions need confirmation", () => {
    const a = answers({ destructive: { type: "noul", noul: 0.9 } });
    expect(decide(a, "place the order", YOUTUBE, paused).type).toBe("confirm");
  });

  test("scroll amount comes from the score", () => {
    const a = answers({
      intent: { type: "choice", choice: "scroll", confidence: 0.99, probabilities: {} },
      scroll_dir: { type: "choice", choice: "up", confidence: 0.9, probabilities: {} },
      scroll_amount: { type: "score", score: 1.8, legend: [], probabilities: {}, confidence: 0.9 },
    });
    expect(decide(a, "scroll to the top", YOUTUBE, talking)).toMatchObject({ type: "act", action: { kind: "scroll", direction: "up", amount: "end" } });
  });
});
