// Audio helpers: an energy-based voice activity detector and a WAV encoder.
// Audio is 16 kHz mono Int16, the format whisper.cpp expects.

export const SAMPLE_RATE = 16_000;
export const FRAME = 320; // 20 ms

export interface VadEvent {
  type: "start" | "end";
}

/**
 * Tracks a noise floor and flags speech when a frame's RMS is well above it.
 * Speech starts after `startFrames` loud frames and ends after `endMs` of quiet.
 */
export class Vad {
  private noise = 0.003;
  private loud = 0;
  private quietMs = 0;
  speaking = false;
  /** ms since the last loud frame (0 while talking). */
  silenceMs = Number.POSITIVE_INFINITY;

  constructor(
    readonly endMs = 700,
    readonly startFrames = 3,
    readonly ratio = 3,
    readonly minLevel = 0.008,
  ) {}

  push(frame: Int16Array): VadEvent | null {
    const level = rms(frame);
    const ms = (frame.length / SAMPLE_RATE) * 1000;
    const isLoud = level > Math.max(this.noise * this.ratio, this.minLevel);

    if (!isLoud) this.noise = this.noise * 0.95 + level * 0.05; // adapt only on quiet frames

    if (isLoud) {
      this.loud++;
      this.quietMs = 0;
      this.silenceMs = 0;
      if (!this.speaking && this.loud >= this.startFrames) {
        this.speaking = true;
        return { type: "start" };
      }
    } else {
      this.loud = 0;
      this.quietMs += ms;
      this.silenceMs = this.speaking ? this.quietMs : this.silenceMs + ms;
      if (this.speaking && this.quietMs >= this.endMs) {
        this.speaking = false;
        return { type: "end" };
      }
    }
    return null;
  }
}

export function rms(frame: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i] / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / Math.max(1, frame.length));
}

/** Concatenate Int16 chunks into one 16-bit PCM WAV file. */
export function wav(chunks: Int16Array[], sampleRate = SAMPLE_RATE): Uint8Array<ArrayBuffer> {
  const samples = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true); // PCM chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, c[i], true);
  }
  return new Uint8Array(buf);
}
