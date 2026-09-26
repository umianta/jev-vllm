// Speech-to-text through a local whisper.cpp server (scripts/setup-whisper.ts).
import { wav } from "./audio";

export interface Transcriber {
  transcribe(chunks: Int16Array[], signal?: AbortSignal): Promise<{ text: string; ms: number }>;
}

// Whisper's usual output on silence or noise; never a real command.
const HALLUCINATIONS = /^(\[.*\]|\(.*\)|thank you\.?|thanks for watching!?|you|bye\.?|\.+)$/i;

export class WhisperServer implements Transcriber {
  constructor(readonly url: string) {}

  async transcribe(chunks: Int16Array[], signal?: AbortSignal) {
    const started = performance.now();
    const form = new FormData();
    form.append("file", new Blob([wav(chunks)], { type: "audio/wav" }), "speech.wav");
    form.append("response_format", "json");
    form.append("temperature", "0");
    const res = await fetch(`${this.url.replace(/\/$/, "")}/inference`, { method: "POST", body: form, signal });
    if (!res.ok) throw new Error(`whisper ${res.status}: ${await res.text()}`);
    const body: any = await res.json();
    return { text: cleanTranscript(String(body.text ?? "")), ms: Math.round(performance.now() - started) };
  }
}

export function cleanTranscript(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return HALLUCINATIONS.test(t) ? "" : t;
}
