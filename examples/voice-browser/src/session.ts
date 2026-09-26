// One connected browser: audio in → utterances → partial transcripts → decisions → actions.
//
// While someone talks, the growing utterance is re-transcribed every PARTIAL_EVERY_MS
// and each new transcript is decided on. A confident, complete command acts at once,
// often before the speaker has finished; everything else waits for more words or the
// end of the utterance. Each utterance acts at most once.
import { FRAME, SAMPLE_RATE, Vad } from "./audio";
import type { Djev } from "./djev";
import { decide } from "./policy";
import { confirmation } from "./spans";
import type { Transcriber } from "./stt";
import type { Action, ClientMessage, PageState, ServerMessage } from "./types";

export const TIMING = {
  partialEveryMs: 300, // re-transcribe after this much new speech
  debounceMs: 150, // wait for the transcript to settle before deciding
  maxInflight: 2, // concurrent decisions
  prerollMs: 300, // audio kept from before speech starts
  maxUtteranceMs: 15_000,
};

interface Utterance {
  id: number;
  chunks: Int16Array[];
  samples: number;
  transcribedAt: number; // samples at the last partial transcription
  lastText: string;
  acted: boolean;
}

export class Session {
  page: PageState = { url: "about:blank", title: "", elements: [] };
  readonly recent: string[] = [];
  private vad = new Vad();
  private utterance: Utterance | null = null;
  private preroll: Int16Array[] = [];
  private nextId = 0;
  private partialBusy = false;
  private seq = 0;
  private newestDecided = 0;
  private inflight = 0;
  private queued: (() => void) | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private pending: { action: Action; utterance: number } | null = null;

  constructor(
    private stt: Transcriber,
    private djev: Djev,
    private send: (m: ServerMessage) => void,
  ) {}

  /** Raw Int16 PCM at 16 kHz; any length, split into 20 ms frames here. */
  onAudio(pcm: Int16Array) {
    for (let i = 0; i + FRAME <= pcm.length; i += FRAME) this.onFrame(pcm.subarray(i, i + FRAME).slice());
  }

  onMessage(m: ClientMessage) {
    if (m.type === "page") this.page = m.page;
    else if (m.type === "done") {
      this.recent.push(m.ok ? m.action.label : `${m.action.label} (failed: ${m.error ?? "error"})`);
      if (this.recent.length > 3) this.recent.shift();
    } else if (m.type === "reset") {
      this.recent.length = 0;
      this.pending = null;
    }
  }

  private onFrame(frame: Int16Array) {
    const ev = this.vad.push(frame);
    if (ev?.type === "start") {
      this.utterance = {
        id: ++this.nextId,
        chunks: [...this.preroll],
        samples: this.preroll.length * FRAME,
        transcribedAt: 0,
        lastText: "",
        acted: false,
      };
      this.preroll = [];
      this.send({ type: "speech", speaking: true });
    }

    const u = this.utterance;
    if (!u) {
      this.preroll.push(frame);
      if (this.preroll.length * FRAME > (TIMING.prerollMs / 1000) * SAMPLE_RATE) this.preroll.shift();
      return;
    }

    u.chunks.push(frame);
    u.samples += frame.length;
    const tooLong = u.samples > (TIMING.maxUtteranceMs / 1000) * SAMPLE_RATE;

    if (ev?.type === "end" || tooLong) {
      this.utterance = null;
      this.send({ type: "speech", speaking: false });
      void this.transcribe(u, true);
    } else if (!this.partialBusy && u.samples - u.transcribedAt >= (TIMING.partialEveryMs / 1000) * SAMPLE_RATE) {
      void this.transcribe(u, false);
    }
  }

  private async transcribe(u: Utterance, final: boolean) {
    if (!final) this.partialBusy = true;
    u.transcribedAt = u.samples;
    try {
      const { text, ms } = await this.stt.transcribe(u.chunks.slice());
      if (!text || (!final && text === u.lastText)) return;
      u.lastText = text;
      this.send({ type: "transcript", utterance: u.id, text, final, sttMs: ms });
      this.schedule(u, text, final);
    } catch (e) {
      this.send({ type: "error", message: `speech-to-text: ${(e as Error).message}` });
    } finally {
      if (!final) this.partialBusy = false;
    }
  }

  private schedule(u: Utterance, text: string, final: boolean) {
    if (this.debounce) clearTimeout(this.debounce);
    const run = () => {
      if (this.inflight >= TIMING.maxInflight && !final) {
        this.queued = run; // only the newest waiting transcript matters
        return;
      }
      void this.runDecision(u, text, final);
    };
    if (final) run();
    else this.debounce = setTimeout(run, TIMING.debounceMs);
  }

  private async runDecision(u: Utterance, text: string, final: boolean) {
    if (u.acted) return;
    const seq = ++this.seq;
    this.inflight++;
    let result;
    try {
      result = await this.djev.decide(text, this.page, this.recent);
    } catch (e) {
      this.send({ type: "error", message: `djev: ${(e as Error).message}` });
      return;
    } finally {
      this.inflight--;
      const next = this.queued;
      this.queued = null;
      next?.();
    }
    // Drop results that are older than one already acted on, or for an utterance that already acted.
    if (u.acted || seq < this.newestDecided) return;
    this.newestDecided = seq;

    if (this.pending && this.pending.utterance !== u.id) {
      const c = confirmation(text);
      if (c) {
        u.acted = true;
        const p = this.pending;
        this.pending = null;
        if (c === "confirm") this.act(u, p.action, text, result.ms);
        else this.send({ type: "decision", utterance: u.id, text, verdict: { type: "ignore", reason: "cancelled" }, intent: "cancel", confidence: 1, ms: result.ms });
        return;
      }
    }

    const silenceMs = this.utterance?.id === u.id ? this.vad.silenceMs : Number.POSITIVE_INFINITY;
    const verdict = decide(result.answers, text, this.page, { final, silenceMs });
    const { intent } = result.answers;
    this.send({ type: "decision", utterance: u.id, text, verdict, intent: intent.choice, confidence: intent.confidence, ms: result.ms });

    if (verdict.type === "act") this.act(u, verdict.action);
    else if (verdict.type === "confirm") {
      u.acted = true;
      this.pending = { action: verdict.action, utterance: u.id };
      if (verdict.action.kind === "click" || verdict.action.kind === "type") {
        this.send({ type: "action", utterance: u.id, action: { kind: "highlight", ids: [verdict.action.id], label: "confirm?" } });
      }
    } else if (verdict.type === "disambiguate") {
      this.send({ type: "action", utterance: u.id, action: { kind: "highlight", ids: verdict.candidates, label: "which one?" } });
    }
  }

  private act(u: Utterance, action: Action, text?: string, ms?: number) {
    u.acted = true;
    if (text !== undefined) {
      this.send({ type: "decision", utterance: u.id, text, verdict: { type: "act", action }, intent: "confirm", confidence: 1, ms: ms ?? 0 });
    }
    this.send({ type: "action", utterance: u.id, action });
  }
}
