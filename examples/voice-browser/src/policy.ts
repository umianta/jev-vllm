// Answers + timing → what to do now. Everything tunable lives in THRESHOLDS.
import { resolveSite, searchUrl } from "./sites";
import { searchSpan, siteSpan, typeSpan } from "./spans";
import type { Action, Answers, PageState, Verdict } from "./types";

export const THRESHOLDS = {
  isCommand: 0.5, // below: not addressed to the browser
  intent: 0.55, // below: not sure what to do yet
  complete: 0.6, // below: wait for more words, unless the speaker paused
  pauseMs: 900, // this much silence counts as "finished"
  freeTextPauseMs: 600, // search/type text keeps growing, so wait for a pause
  target: 0.45, // click/type: act only above this
  targetFloor: 0.2, // candidates shown for disambiguation must beat this
  destructive: 0.5, // above: ask for a spoken "confirm"
};

export interface Timing {
  final: boolean; // recognizer finished the utterance
  silenceMs: number; // time since the last speech frame
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function decide(answers: Answers, transcript: string, page: PageState, timing: Timing): Verdict {
  const T = THRESHOLDS;
  const paused = timing.final || timing.silenceMs >= T.pauseMs;
  const { intent } = answers;

  if (answers.is_command.noul < T.isCommand) {
    return paused
      ? { type: "ignore", reason: `not a browser command (${pct(answers.is_command.noul)})` }
      : { type: "wait", reason: "listening" };
  }
  if (intent.choice === "none") return paused ? { type: "ignore", reason: "no action" } : { type: "wait", reason: "listening" };
  if (intent.confidence < T.intent) return { type: "wait", reason: `unsure: ${intent.choice} ${pct(intent.confidence)}` };
  if (answers.complete.noul < T.complete && !paused) return { type: "wait", reason: "command not finished" };

  const freeText = intent.choice === "search" || intent.choice === "type";
  if (freeText && !(timing.final || timing.silenceMs >= T.freeTextPauseMs)) {
    return { type: "wait", reason: "waiting for the end of the text" };
  }

  const built = buildAction(answers, transcript, page);
  if ("wait" in built) return { type: "wait", reason: built.wait };
  if ("disambiguate" in built) return { type: "disambiguate", candidates: built.disambiguate, reason: built.reason };

  if (answers.destructive.noul >= T.destructive) {
    return { type: "confirm", action: built, reason: `may submit or delete (${pct(answers.destructive.noul)}); say "confirm"` };
  }
  return { type: "act", action: built };
}

type Built = Action | { wait: string } | { disambiguate: string[]; reason: string };

function label(page: PageState, id: string) {
  const e = page.elements.find((x) => x.id === id);
  return e ? `${e.role} "${e.text}"` : id;
}

/** Candidates above the floor, best first (at most three). */
function candidates(answers: Answers) {
  const probs = answers.target?.probabilities ?? {};
  return Object.entries(probs)
    .filter(([, p]) => p >= THRESHOLDS.targetFloor)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
}

function pickTarget(answers: Answers, page: PageState): { id: string } | { wait: string } | { disambiguate: string[]; reason: string } {
  const t = answers.target;
  if (!t || page.elements.length === 0) return { wait: "no clickable elements on this page" };
  if (t.confidence >= THRESHOLDS.target) return { id: t.choice };
  const c = candidates(answers);
  if (c.length >= 2) return { disambiguate: c, reason: "which one? say its letter" };
  return { wait: `unsure which element (${pct(t.confidence)})` };
}

export function buildAction(answers: Answers, transcript: string, page: PageState): Built {
  switch (answers.intent.choice) {
    case "open": {
      const site = siteSpan(transcript);
      if (!site) return { wait: "which site?" };
      return { kind: "open", url: resolveSite(site), label: `open ${site}` };
    }
    case "search": {
      const s = searchSpan(transcript);
      if (!s) return { wait: "search for what?" };
      return { kind: "open", url: searchUrl(s.text, s.site, page.url), label: `search "${s.text}"${s.site ? ` on ${s.site}` : ""}` };
    }
    case "click": {
      const t = pickTarget(answers, page);
      if (!("id" in t)) return t;
      return { kind: "click", id: t.id, label: `click ${label(page, t.id)}` };
    }
    case "type": {
      const text = typeSpan(transcript);
      if (!text) return { wait: "type what?" };
      const t = pickTarget(answers, page);
      if (!("id" in t)) return t;
      const submit = /\b(and )?(press enter|hit enter|submit|send it|search)\b/i.test(transcript);
      return { kind: "type", id: t.id, text: text.replace(/\s*(and )?(press|hit) enter$/i, ""), submit, label: `type "${text}" into ${label(page, t.id)}` };
    }
    case "scroll": {
      const direction = answers.scroll_dir.choice === "up" ? "up" : "down";
      const amount = (["little", "page", "end"] as const)[Math.max(0, Math.min(2, Math.round(answers.scroll_amount.score)))];
      return { kind: "scroll", direction, amount, label: `scroll ${direction} (${amount})` };
    }
    case "back":
    case "forward":
    case "reload":
    case "close":
      return { kind: answers.intent.choice, label: answers.intent.choice };
    case "tab":
      return { kind: "newtab", label: "new tab" };
    case "switch": {
      const which = answers.tab_which.choice as "next" | "previous" | "first" | "last";
      return { kind: "switch", which, label: `switch to ${which} tab` };
    }
    default:
      return { wait: "no action" };
  }
}
