import { describe, expect, test } from "bun:test";
import { FRAME, SAMPLE_RATE, Vad, wav } from "../src/audio";

export function tone(ms: number, amp = 0.3, hz = 220): Int16Array {
  const n = Math.round((ms / 1000) * SAMPLE_RATE);
  return Int16Array.from({ length: n }, (_, i) => Math.round(Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE) * amp * 32767));
}
export const silence = (ms: number, amp = 0.001) => tone(ms, amp, 50);

function feed(vad: Vad, pcm: Int16Array) {
  const events: string[] = [];
  for (let i = 0; i + FRAME <= pcm.length; i += FRAME) {
    const e = vad.push(pcm.subarray(i, i + FRAME));
    if (e) events.push(e.type);
  }
  return events;
}

describe("Vad", () => {
  test("detects a burst of speech and its end", () => {
    const vad = new Vad(700);
    expect(feed(vad, silence(500))).toEqual([]);
    expect(feed(vad, tone(600))).toEqual(["start"]);
    expect(vad.silenceMs).toBe(0);
    expect(feed(vad, silence(400))).toEqual([]); // a short pause does not end it
    expect(feed(vad, tone(200))).toEqual([]);
    expect(feed(vad, silence(800))).toEqual(["end"]);
  });

  test("ignores steady background noise", () => {
    const vad = new Vad();
    expect(feed(vad, silence(2000, 0.004))).toEqual([]);
  });

  test("a single click is not speech", () => {
    const vad = new Vad();
    expect(feed(vad, Int16Array.from([...silence(300), ...tone(20), ...silence(300)]))).toEqual([]);
  });
});

describe("wav", () => {
  test("16-bit mono PCM header", () => {
    const w = wav([tone(100), tone(100)]);
    const v = new DataView(w.buffer);
    const tag = (o: number) => String.fromCharCode(...w.subarray(o, o + 4));
    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint32(40, true)).toBe(2 * 3200); // 200 ms of 16-bit samples
    expect(w.length).toBe(44 + 6400);
  });
});
