// The full session loop with fake speech-to-text and a fake djev: checks that a
// command acts while the speaker is still talking, and only once per utterance.
import { describe, expect, test } from "bun:test";
import { YOUTUBE } from "../eval/fixtures";
import type { Djev } from "../src/djev";
import { Session } from "../src/session";
import type { Transcriber } from "../src/stt";
import type { Answers, ServerMessage } from "../src/types";
import { silence, tone } from "./audio.test";

const choice = (c: string, p = 0.97) => ({ type: "choice", choice: c, confidence: p, probabilities: { [c]: p } });

function fakeAnswers(transcript: string): Answers {
  const words = transcript.split(" ").length;
  return {
    is_command: { type: "noul", noul: 0.99 },
    complete: { type: "noul", noul: words >= 4 ? 0.98 : 0.1 }, // "click the rust video" is complete
    intent: choice("click"),
    target: choice("k"),
    destructive: { type: "noul", noul: 0.01 },
    scroll_dir: choice("down"),
    scroll_amount: { type: "score", score: 1, legend: [], probabilities: {}, confidence: 0.9 },
    tab_which: choice("next"),
    is_correction: { type: "noul", noul: 0.01 },
  } as Answers;
}

/** Each call reveals one more word of the sentence, like a growing partial transcript. */
function fakeStt(sentence: string): Transcriber & { calls: number } {
  const words = sentence.split(" ");
  const stt = {
    calls: 0,
    async transcribe() {
      stt.calls++;
      await Bun.sleep(5);
      return { text: words.slice(0, Math.min(words.length, stt.calls)).join(" "), ms: 5 };
    },
  };
  return stt;
}

const fakeDjev = {
  decisions: 0,
  async decide(t: string) {
    fakeDjev.decisions++;
    await Bun.sleep(5);
    return { answers: fakeAnswers(t), ms: 5 };
  },
};

describe("Session", () => {
  test("acts once, before the utterance ends", async () => {
    const out: ServerMessage[] = [];
    const s = new Session(fakeStt("click the rust video please"), fakeDjev as unknown as Djev, (m) => out.push(m));
    s.onMessage({ type: "page", page: YOUTUBE });

    // Stream ~3 s of speech in 100 ms chunks at real-time pace, then silence.
    for (let i = 0; i < 30; i++) {
      s.onAudio(tone(100));
      await Bun.sleep(20);
    }
    const actedWhileTalking = out.some((m) => m.type === "action");
    s.onAudio(silence(900));
    await Bun.sleep(300);

    const actions = out.filter((m) => m.type === "action");
    expect(actedWhileTalking).toBe(true);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ action: { kind: "click", id: "k" } });
    expect(out.find((m) => m.type === "speech")).toMatchObject({ speaking: true });
    expect(out.at(-1)).toMatchObject({ type: "transcript", final: true });
  });

  test("records finished actions as context, keeping the last three", () => {
    const s = new Session(fakeStt("x"), fakeDjev as unknown as Djev, () => {});
    for (const label of ["a", "b", "c", "d"]) s.onMessage({ type: "done", action: { kind: "reload", label }, ok: true });
    expect(s.recent).toEqual(["b", "c", "d"]);
  });
});
