// The explainer video: architecture, design, live /v1/systemone requests, performance
// and the voice browser. 1920×1080, 30 fps, silent with on-screen captions.
//
//   bun capture.ts                      # record real payloads + timings (needs djev)
//   bun video.ts                        # render ../../docs/social/jev-vllm-explainer.mp4
//   bun video.ts --stills 3,20,45       # render single frames to check a layout
//
// Everything shown comes from video-data.json (captured from a live deployment),
// the README diagrams and the voice-browser screenshot.
import { cpus } from "node:os";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ff, ffmpegPath, flatten, freeze, MONO, nest, png, SANS } from "./lib";

const { values: opts } = parseArgs({
  options: {
    out: { type: "string", default: resolve(import.meta.dir, "../../docs/social") },
    stills: { type: "string" },
    worker: { type: "string" }, // internal: "from:to" frame range
    frames: { type: "string" }, // internal: frame directory
  },
});

const W = 1920, H = 1080, FPS = 30;
const ROOT = resolve(import.meta.dir, "../..");
const data = JSON.parse(readFileSync(join(import.meta.dir, "video-data.json"), "utf8"));
const archSvg = flatten(readFileSync(join(ROOT, "docs/arch.svg"), "utf8"), "dark");
const infSvg = flatten(readFileSync(join(ROOT, "docs/inference.svg"), "utf8"), "dark");
const demoPng = readFileSync(join(ROOT, "examples/voice-browser/docs/demo.png")).toString("base64");

// ---- look ------------------------------------------------------------------

const C = {
  bg: "#0d1117", panel: "#161b22", panel2: "#1c2128", line: "#30363d", fg: "#e6edf3", muted: "#9198a1",
  blue: "#4493f8", green: "#3fb950", purple: "#ab7df8", orange: "#d29922", red: "#f85149",
  key: "#79c0ff", str: "#a5d6ff", num: "#ffa657", punct: "#8b949e",
};
const CW = 0.602; // DejaVu Sans Mono advance, in em

// ---- timing helpers ------------------------------------------------------------

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
/** 0→1 eased progress of an animation starting at `at` lasting `dur` seconds. */
const prog = (t: number, at: number, dur = 0.6) => easeOut((t - at) / dur);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- drawing helpers -------------------------------------------------------------

interface TextOpts { size?: number; weight?: number; fill?: string; anchor?: "start" | "middle" | "end"; font?: string; opacity?: number }
function txt(x: number, y: number, s: string, o: TextOpts = {}) {
  return `<text x="${x}" y="${y}" font-family="${o.font ?? SANS}" font-size="${o.size ?? 28}" font-weight="${o.weight ?? 400}" fill="${o.fill ?? C.fg}" text-anchor="${o.anchor ?? "start"}"${o.opacity !== undefined ? ` opacity="${o.opacity.toFixed(3)}"` : ""}>${esc(s)}</text>`;
}
/** Fade + rise in from `at`. */
function appear(t: number, at: number, body: string, rise = 18) {
  const p = prog(t, at, 0.55);
  if (p <= 0) return "";
  return `<g opacity="${p.toFixed(3)}" transform="translate(0 ${((1 - p) * rise).toFixed(1)})">${body}</g>`;
}
const rect = (x: number, y: number, w: number, h: number, fill: string, r = 12, extra = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${extra}/>`;
const glow = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>`;
function dot(x: number, y: number, color: string, r = 9) {
  return `<circle cx="${x}" cy="${y}" r="${r * 1.8}" fill="${color}" opacity="0.45" filter="url(#glow)"/><circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`;
}

function header(t: number, kicker: string, title: string) {
  return appear(t, 0.1, txt(120, 130, kicker, { size: 24, weight: 700, fill: C.purple })) +
    appear(t, 0.25, txt(120, 188, title, { size: 52, weight: 700 }));
}
function caption(t: number, at: number, s: string, y = 1000) {
  return appear(t, at, txt(W / 2, y, s, { size: 30, fill: C.muted, anchor: "middle" }), 10);
}

// ---- JSON rendering ------------------------------------------------------------------

type Tok = { s: string; c: string };
type Line = { indent: number; toks: Tok[] };

/** Pretty-print JSON as coloured token lines; floats rounded for legibility. */
function jsonLines(value: unknown, round = 4): Line[] {
  const lines: Line[] = [];
  const scalar = (v: unknown): Tok => {
    if (typeof v === "string") return { s: JSON.stringify(v), c: C.str };
    if (typeof v === "number") return { s: String(Number.isInteger(v) ? v : +v.toFixed(round)), c: C.num };
    return { s: String(v), c: C.red };
  };
  const walk = (v: unknown, indent: number, prefix: Tok[], comma: boolean) => {
    const end = comma ? [{ s: ",", c: C.punct }] : [];
    if (v && typeof v === "object") {
      const arr = Array.isArray(v);
      const entries = arr ? (v as unknown[]).map((x) => [null, x] as const) : Object.entries(v as object);
      // Small flat objects stay on one line.
      const flat = entries.every(([, x]) => !x || typeof x !== "object");
      const oneLine = entries.map(([k, x]) => (k === null ? "" : `"${k}": `) + scalar(x).s).join(", ");
      if (flat && oneLine.length <= 58) {
        const toks: Tok[] = [...prefix, { s: arr ? "[" : "{", c: C.punct }];
        entries.forEach(([k, x], i) => {
          if (k !== null) toks.push({ s: `"${k}"`, c: C.key }, { s: ": ", c: C.punct });
          toks.push(scalar(x));
          if (i < entries.length - 1) toks.push({ s: ", ", c: C.punct });
        });
        toks.push({ s: arr ? "]" : "}", c: C.punct }, ...end);
        lines.push({ indent, toks });
        return;
      }
      lines.push({ indent, toks: [...prefix, { s: arr ? "[" : "{", c: C.punct }] });
      entries.forEach(([k, x], i) => {
        const p: Tok[] = k === null ? [] : [{ s: `"${k}"`, c: C.key }, { s: ": ", c: C.punct }];
        walk(x, indent + 1, p, i < entries.length - 1);
      });
      lines.push({ indent, toks: [{ s: arr ? "]" : "}", c: C.punct }, ...end] });
      return;
    }
    lines.push({ indent, toks: [...prefix, scalar(v), ...end] });
  };
  walk(value, 0, [], false);
  return lines;
}

type Row = { col: number; toks: Tok[]; line: number; text: string };

/** Soft-wrap logical lines to `cols` columns; continuation rows indent 4 more. */
function wrap(lines: Line[], cols: number): Row[] {
  const rows: Row[] = [];
  lines.forEach((ln, li) => {
    const chars: { ch: string; c: string }[] = [];
    for (const tk of ln.toks) for (const ch of tk.s) chars.push({ ch, c: tk.c });
    let col = ln.indent * 2;
    let i = 0;
    let first = true;
    while (i < chars.length || first) {
      let room = Math.max(8, cols - col);
      if (i + room < chars.length) {
        // Break after the last space in the row, like an editor's soft wrap.
        const sp = chars.slice(i, i + room).map((p) => p.ch).lastIndexOf(" ");
        if (sp > room * 0.5) room = sp + 1;
      }
      const part = chars.slice(i, i + room);
      const toks: Tok[] = [];
      for (const p of part) {
        const last = toks[toks.length - 1];
        if (last && last.c === p.c) last.s += p.ch;
        else toks.push({ s: p.ch, c: p.c });
      }
      rows.push({ col, toks, line: li, text: part.map((p) => p.ch).join("") });
      i += room;
      if (first) col += 4;
      first = false;
    }
  });
  return rows;
}

let clipSeq = 0;
/**
 * Draw JSON in a clipped box: reveal the first `reveal` characters (typewriter),
 * scroll by `scroll` rows (or follow the cursor), highlight logical lines matching `hi`.
 */
function drawJson(lines: Line[], box: { x: number; y: number; w: number; h: number }, o: { size?: number; lh?: number; reveal?: number; scroll?: number; follow?: boolean; hi?: RegExp[]; hiP?: number } = {}) {
  const size = o.size ?? 20, lh = o.lh ?? 29;
  const cols = Math.floor(box.w / (size * CW));
  const rows = wrap(lines, cols);
  const visible = Math.floor(box.h / lh);
  let budget = o.reveal ?? Number.POSITIVE_INFINITY;
  let lastRow = -1;
  const shownPer = rows.map((r, i) => {
    const n = Math.max(0, Math.min(r.text.length, budget));
    budget -= r.text.length + (rows[i + 1]?.line !== r.line ? 1 : 0);
    if (n > 0) lastRow = i;
    return n;
  });
  const scroll = o.follow ? Math.max(0, lastRow - visible + 2) : (o.scroll ?? 0);
  const lineText = lines.map((ln) => ln.toks.map((t) => t.s).join(""));
  const id = `clip${clipSeq++}`;
  const out: string[] = [`<clipPath id="${id}"><rect x="${box.x - 14}" y="${box.y}" width="${box.w + 28}" height="${box.h}"/></clipPath><g clip-path="url(#${id})">`];
  rows.forEach((r, i) => {
    const shown = shownPer[i];
    if (!shown) return;
    const ly = box.y + (i - scroll + 1) * lh - lh * 0.28;
    if (ly < box.y - lh || ly > box.y + box.h + lh) return;
    if (o.hi?.some((re) => re.test(lineText[r.line])) && (o.hiP ?? 0) > 0) {
      out.push(rect(box.x + r.col * size * CW - 10, ly - size * 0.98, size * CW * shown + 20, lh - 2, C.green, 6, `opacity="${(0.2 * (o.hiP ?? 0)).toFixed(3)}"`));
    }
    let col = r.col, left = shown;
    const spans: string[] = [];
    for (const tk of r.toks) {
      if (left <= 0) break;
      const t = tk.s.slice(0, left);
      spans.push(`<tspan x="${(box.x + col * size * CW).toFixed(1)}" fill="${tk.c}">${esc(t)}</tspan>`);
      col += t.length;
      left -= t.length;
    }
    out.push(`<text y="${ly.toFixed(1)}" font-family="${MONO}" font-size="${size}" xml:space="preserve">${spans.join("")}</text>`);
  });
  out.push("</g>");
  return out.join("");
}

// ---- scenes ------------------------------------------------------------------------------

type Scene = { dur: number; draw: (t: number) => string };

const title: Scene = {
  dur: 6,
  draw: (t) =>
    appear(t, 0.2, txt(W / 2, 470, "jev-vllm", { size: 132, weight: 700, anchor: "middle" }), 30) +
    appear(t, 0.8, txt(W / 2, 560, "A self-hosted decision API: typed questions in, probabilities out", { size: 40, fill: C.muted, anchor: "middle" })) +
    appear(t, 1.5, txt(W / 2, 640, "DiffusionGemma 26B · vLLM · KServe · one NVIDIA GB10", { size: 30, fill: C.purple, anchor: "middle", weight: 600 })) +
    appear(t, 2.3, txt(W / 2, 760, "Architecture · live API requests · performance · a voice-controlled browser", { size: 28, fill: C.muted, anchor: "middle" })),
};

function timerCard(t: number, x: number, label: string, sub: string, ms: number, answer: string[], answerColor: string, notes: string[], start: number) {
  const SLOW = 5;
  const elapsed = clamp((t - start) / SLOW, 0, ms / 1000) * 1000;
  const done = elapsed >= ms;
  const w = 780;
  let s = rect(x, 250, w, 600, C.panel, 16, `stroke="${C.line}" stroke-width="2"`);
  s += txt(x + 40, 320, label, { size: 34, weight: 700 });
  s += txt(x + 40, 362, sub, { size: 24, fill: C.muted, font: MONO });
  s += txt(x + w - 40, 320, `${Math.round(elapsed)} ms`, { size: 44, weight: 700, anchor: "end", fill: done ? answerColor : C.muted, font: MONO });
  s += rect(x + 40, 400, w - 80, 8, C.line, 4) + rect(x + 40, 400, (w - 80) * clamp(elapsed / 616), 8, answerColor, 4);
  if (done) {
    const p = prog(t, start + ms / 1000 * SLOW, 0.4);
    answer.forEach((a, i) => (s += txt(x + 40, 490 + i * 50, a, { size: 34, font: MONO, fill: answerColor, opacity: p })));
    notes.forEach((n, i) => (s += txt(x + 40, 660 + i * 50, n, { size: 28, fill: C.fg, opacity: p })));
  } else {
    s += txt(x + 40, 490, "waiting…", { size: 30, fill: C.muted, font: MONO });
  }
  return s;
}

const problem: Scene = {
  dur: 11,
  draw: (t) => {
    const chat = data.chat.response.choices[0].message.content as string;
    const noul = data.simple.response.answers.urgent.noul as number;
    return header(t, "THE PROBLEM", "Apps mostly ask LLMs small, typed questions") +
      appear(t, 0.6, txt(120, 238, `“Everything is down and we have a demo at noon.”  Does the customer need a reply within the hour?`, { size: 26, fill: C.muted })) +
      appear(t, 1.0, timerCard(t, 120, "Plain chat", "same model, /v1/chat/completions", data.chat.ms, chat.split("\n").map((l) => JSON.stringify(l).slice(1, -1)), C.orange,
        ["× text you have to parse", "× no probability to threshold"], 1.6)) +
      appear(t, 1.0, timerCard(t, 1020, "Structured read", "/v1/systemone", data.simple.ms, [`"urgent": { "noul": ${noul.toFixed(3)} }`], C.green,
        ["✓ one typed value", "✓ rule-ready: escalate if p > 0.8"], 1.6)) +
      caption(t, 2.0, "Real timings from one GB10, animation slowed 5×", 920);
  },
};

// Arrow geometry of docs/arch.svg (viewBox 960×240), for the moving dots.
const ARCH = { x: 110, y: 330, w: 1700 };
const archPt = (vx: number, vy: number) => [ARCH.x + (vx * ARCH.w) / 960, ARCH.y + (vy * ARCH.w) / 960] as const;
function along(t: number, at: number, dur: number, from: number, to: number, vy: number, color: string) {
  const p = (t - at) / dur;
  if (p < 0 || p > 1) return "";
  const [x, y] = archPt(from + (to - from) * easeInOut(p), vy);
  return dot(x, y, color);
}

const architecture: Scene = {
  dur: 12,
  draw: (t) => {
    const { body } = nest(archSvg, ARCH.x, ARCH.y, ARCH.w);
    const cyc = (t - 1.2) % 4.2;
    const flow = t < 1.2 ? "" :
      along(cyc, 0, 0.7, 240, 368, 92, C.blue) + along(cyc, 0.8, 0.7, 590, 718, 92, C.blue) +
      along(cyc, 2.0, 0.7, 720, 592, 150, C.green) + along(cyc, 2.8, 0.7, 370, 242, 150, C.green);
    return header(t, "ARCHITECTURE", "One GPU node, three hops") +
      appear(t, 0.5, body) + flow +
      appear(t, 2.0, txt(120, 850, "djev (CPU) builds a canvas per question and turns label-token probabilities into answers", { size: 30 })) +
      appear(t, 2.6, txt(120, 900, "vLLM serves DiffusionGemma 26B-A4B (NVFP4) on the GPU through KServe LLMInferenceService", { size: 30 })) +
      appear(t, 3.2, txt(120, 950, "Anything that isn't a structured read passes straight through to vLLM", { size: 30, fill: C.muted }));
  },
};

const inference: Scene = {
  dur: 12,
  draw: (t) => {
    const { body } = nest(freeze(infSvg, Math.max(0, t - 0.8)), 110, 290, 1700);
    return header(t, "HOW ONE READ WORKS", "One denoise step, not token-by-token generation") +
      appear(t, 0.5, body) +
      caption(t, 1.2, "A text-diffusion model fills the answer slot in one parallel pass; djev reads the probabilities of the allowed labels", 900) +
      caption(t, 1.8, "Several questions share one read, and noise draws can be averaged", 950);
  },
};

function apiClient(t: number, req: unknown, res: unknown, ms: number, status: number, o: { typeAt: number; typeDur: number; sendAt: number; hi: RegExp[]; scrollRes?: [number, number, number] }) {
  const reqLines = jsonLines(req);
  const resLines = jsonLines(res);
  const total = reqLines.reduce((n, l) => n + "  ".repeat(l.indent).length + l.toks.reduce((m, k) => m + k.s.length, 0) + 1, 0);
  const reveal = total * clamp((t - o.typeAt) / o.typeDur);
  const recvAt = o.sendAt + 0.35 + ms / 1000;
  const got = t >= recvAt;

  let s = rect(80, 225, 1760, 790, C.panel, 16, `stroke="${C.line}" stroke-width="2"`);
  // request line
  s += rect(110, 250, 120, 56, C.green, 8, 'opacity="0.18"') + txt(170, 289, "POST", { size: 26, weight: 700, fill: C.green, anchor: "middle", font: MONO });
  s += rect(245, 250, 1360, 56, C.bg, 8, `stroke="${C.line}"`) + txt(270, 289, data.endpoint, { size: 26, font: MONO });
  const pressed = t >= o.sendAt && t < o.sendAt + 0.25;
  s += rect(1625, 250, 185, 56, pressed ? "#6e40c9" : C.purple, 8) + txt(1717, 289, t >= o.sendAt && !got ? "Sending…" : "Send", { size: 26, weight: 700, fill: "#fff", anchor: "middle" });
  // panes
  s += txt(110, 356, "Request body · JSON", { size: 22, fill: C.muted, weight: 600 });
  s += txt(980, 356, "Response", { size: 22, fill: C.muted, weight: 600 });
  s += `<line x1="955" y1="335" x2="955" y2="990" stroke="${C.line}" stroke-width="2"/>`;
  s += drawJson(reqLines, { x: 110, y: 372, w: 820, h: 620 }, { reveal, follow: true });
  if (got) {
    const p = prog(t, recvAt, 0.3);
    s += `<g opacity="${p.toFixed(3)}">` +
      txt(1110, 356, `${status} OK`, { size: 22, weight: 700, fill: C.green }) +
      txt(1230, 356, `${ms} ms`, { size: 22, weight: 700, fill: C.fg, font: MONO }) +
      txt(1360, 356, `${Math.round(JSON.stringify(res).length / 100) / 10} KB`, { size: 22, fill: C.muted }) +
      drawJson(resLines, { x: 980, y: 372, w: 830, h: 620 }, {
        hi: o.hi, hiP: prog(t, recvAt + 0.4, 0.5),
        scroll: o.scrollRes ? easeInOut(clamp((t - o.scrollRes[0]) / o.scrollRes[1])) * o.scrollRes[2] : 0,
      }) + "</g>";
  } else if (t >= o.sendAt) {
    const a = ((t - o.sendAt) * 360 * 1.5) % 360;
    s += `<g transform="rotate(${a.toFixed(0)} 1390 640)"><circle cx="1390" cy="640" r="26" fill="none" stroke="${C.purple}" stroke-width="5" stroke-dasharray="60 120"/></g>`;
  }
  return s;
}

const apiSimple: Scene = {
  dur: 11,
  draw: (t) =>
    header(t, "LIVE API", "POST /v1/systemone: one yes/no question") +
    appear(t, 0.4, apiClient(t, data.simple.request, data.simple.response, data.simple.ms, data.simple.status,
      { typeAt: 0.9, typeDur: 2.6, sendAt: 4.0, hi: [/"noul"/] })) +
    caption(t, 5.2, "State + a typed question in, a probability out. Real request and response, captured from the GB10", 1060),
};

const apiMulti: Scene = {
  dur: 15,
  draw: (t) =>
    header(t, "LIVE API", "Four questions in one call") +
    appear(t, 0.4, apiClient(t, data.multi.request, data.multi.response, data.multi.ms, data.multi.status,
      { typeAt: 0.8, typeDur: 2.4, sendAt: 3.6, hi: [/"choice": "bug"/, /"noul": 0\.99/, /"text": "555-0100"/], scrollRes: [8.5, 3, 10] })) +
    caption(t, 4.8, "choice with probabilities · a question that depends_on others · a span pulled out of the text", 1060),
};

function bar(t: number, y: number, label: string, ms: number, color: string, at: number, maxMs: number, note: string) {
  const x0 = 700, wMax = 1000;
  const w = (wMax * ms) / maxMs * prog(t, at, 1.0);
  return appear(t, at - 0.3,
    txt(x0 - 30, y + 38, label, { size: 30, anchor: "end" }) +
    txt(x0 - 30, y + 74, note, { size: 22, anchor: "end", fill: C.muted }) +
    rect(x0, y, Math.max(8, w), 56, color, 4) +
    txt(x0 + Math.max(8, w) + 20, y + 40, `${Math.round(ms * prog(t, at, 1.0))} ms`, { size: 32, weight: 700, font: MONO }));
}
function tile(t: number, x: number, at: number, big: string, small: string) {
  return appear(t, at, rect(x, 760, 520, 160, C.panel, 14, `stroke="${C.line}" stroke-width="2"`) +
    txt(x + 36, 840, big, { size: 56, weight: 700 }) + txt(x + 36, 890, small, { size: 24, fill: C.muted }));
}

const performance: Scene = {
  dur: 12,
  draw: (t) =>
    header(t, "PERFORMANCE", "Latency for one yes/no decision, p50") +
    `<line x1="700" y1="280" x2="700" y2="690" stroke="${C.line}" stroke-width="2"/>` +
    bar(t, 300, "Structured read, 1 draw", 75, C.purple, 0.8, 616, "samples: 1") +
    bar(t, 440, "Structured read, default", 207, C.purple, 1.4, 616, "up to 4 noise draws, averaged") +
    bar(t, 580, "Plain chat, same model", data.chat.ms, C.muted, 2.0, 616, "returns text: “thought\\nYes”") +
    tile(t, 120, 3.2, "98.8 / s", "decisions at 32 concurrent requests") +
    tile(t, 700, 3.6, "96 ms", "p95 with 1 draw, sequential") +
    tile(t, 1280, 4.0, `${data.multi.ms} ms`, "4 questions + a span, one request, 1 draw") +
    caption(t, 4.6, "Measured on one NVIDIA GB10 (client/bench.ts, tools/diagrams/capture.ts). Accuracy not yet evaluated on a labeled set.", 1000),
};

// Row centres of the log entries in the cropped screenshot (1100×639).
const LOG_ROWS = [447, 419, 388, 339, 308, 267, 226]; // Open YouTube → … → Stop.
const voice: Scene = {
  dur: 16,
  draw: (t) => {
    const img = { x: 840, y: 250, w: 1000 };
    const sc = img.w / 1100;
    const active = Math.floor((t - 3.5) / 1.4);
    let hl = "";
    if (active >= 0 && active < LOG_ROWS.length) {
      const cy = img.y + LOG_ROWS[active] * sc;
      hl = rect(img.x + 700 * sc, cy - 17 * sc, 360 * sc, 34 * sc, "none", 6, `stroke="${C.green}" stroke-width="4"`);
    }
    const steps = [
      ["Mic", "your browser, 16 kHz"],
      ["whisper.cpp", "GPU · 33–100 ms"],
      ["/v1/systemone", `10 questions · ${data.voice.ms} ms`],
      ["Policy", "act · wait · confirm"],
      ["Action", "click, type, navigate"],
    ];
    let pipe = "";
    steps.forEach(([a, b], i) => {
      const y = 290 + i * 118;
      pipe += appear(t, 0.6 + i * 0.25, rect(120, y, 620, 92, C.panel, 12, `stroke="${i === 2 ? C.purple : C.line}" stroke-width="2"`) +
        txt(150, y + 44, a, { size: 30, weight: 700, font: i === 2 ? MONO : SANS }) + txt(150, y + 76, b, { size: 22, fill: C.muted }));
    });
    const p = ((t - 2) % 2.4) / 2.4;
    const moving = t > 2 ? dot(100, 336 + p * 4 * 118, C.blue, 8) : "";
    const a = data.voice.response.answers;
    const decision = appear(t, 11.5,
      rect(120, 880, 1720, 120, C.panel, 12, `stroke="${C.green}" stroke-width="2"`) +
      txt(150, 930, `“play the one about transformers” → intent click ${a.intent.confidence.toFixed(3)} · target h ${a.target.confidence.toFixed(3)}`, { size: 30, font: MONO }) +
      txt(150, 975, `h = link "How transformers work, explained visually" · complete ${a.complete.noul.toFixed(2)} · destructive ${a.destructive.noul.toFixed(2)} · ${data.voice.ms} ms`, { size: 24, fill: C.muted, font: MONO }));
    return header(t, "EXAMPLE: VOICE BROWSER", "Talk to your browser; nothing leaves your hardware") +
      pipe + moving +
      appear(t, 1.5, `<image href="data:image/png;base64,${demoPng}" x="${img.x}" y="${img.y}" width="${img.w}" height="${Math.round(639 * sc)}"/>` +
        rect(img.x, img.y, img.w, Math.round(639 * sc), "none", 4, `stroke="${C.line}" stroke-width="2"`)) + hl +
      decision;
  },
};

const START_CMDS: [string, string][] = [
  ["# 1. get the code", C.muted],
  ["git clone https://github.com/umianta/jev-vllm && cd jev-vllm", C.fg],
  ["# 2. deploy DiffusionGemma + djev on a Blackwell GPU node (k8s + KServe)", C.muted],
  ["bun scripts/deploy.ts", C.fg],
  ["# 3. first structured read", C.muted],
  ["kubectl -n jev-vllm port-forward svc/djev 8011:8011 &", C.fg],
  ["curl -s localhost:8011/v1/systemone -H 'content-type: application/json' -d @client/payloads/1-choice.json", C.fg],
  ["# 4. optional: the voice browser", C.muted],
  ["cd examples/voice-browser && bun install && bun run setup:whisper && bun run server", C.fg],
];

const getStarted: Scene = {
  dur: 12,
  draw: (t) => {
    let term = rect(120, 330, 1680, 560, C.panel, 16, `stroke="${C.line}" stroke-width="2"`);
    term += [C.red, C.orange, C.green].map((c, i) => `<circle cx="${160 + i * 32}" cy="366" r="9" fill="${c}" opacity="0.8"/>`).join("");
    const perLine = 0.75;
    START_CMDS.forEach(([cmd, color], i) => {
      const at = 1.2 + i * perLine;
      const chars = Math.floor(cmd.length * clamp((t - at) / (perLine * 0.8)));
      if (chars <= 0) return;
      const prompt = color === C.fg ? "$ " : "";
      term += txt(160, 430 + i * 52, prompt + cmd.slice(0, chars), { size: 26, font: MONO, fill: color });
    });
    return header(t, "GET STARTED", "Open source, Apache-2.0") +
      appear(t, 0.5, txt(120, 280, "github.com/umianta/jev-vllm", { size: 44, weight: 700, font: MONO, fill: C.blue })) +
      term +
      caption(t, 8.5, "Manifests, deploy script, clients, example payloads and the voice browser are all in the repo", 960);
  },
};

const outro: Scene = {
  dur: 7,
  draw: (t) =>
    appear(t, 0.2, txt(W / 2, 420, "github.com/umianta/jev-vllm", { size: 76, weight: 700, anchor: "middle", font: MONO })) +
    appear(t, 0.8, txt(W / 2, 510, "Apache-2.0 · one-command deploy: bun scripts/deploy.ts", { size: 36, fill: C.muted, anchor: "middle" })) +
    appear(t, 1.4, txt(W / 2, 580, "voice browser in examples/voice-browser · 37/38 spoken-command eval", { size: 32, fill: C.muted, anchor: "middle" })) +
    appear(t, 2.2, txt(W / 2, 760, "Same /v1/systemone API as TypeSafe AI's Jev. Not Jev, and not affiliated with TypeSafe AI.", { size: 26, fill: C.muted, anchor: "middle" })) +
    appear(t, 2.6, txt(W / 2, 800, "Built on vLLM PR #57250 and djev by mmastrac.", { size: 26, fill: C.muted, anchor: "middle" })),
};

const SCENES: Scene[] = [title, problem, architecture, inference, apiSimple, apiMulti, performance, voice, getStarted, outro];
const TOTAL = SCENES.reduce((n, s) => n + s.dur, 0);

function frameAt(time: number) {
  let t = time;
  let i = 0;
  while (i < SCENES.length - 1 && t >= SCENES[i].dur) t -= SCENES[i++].dur;
  const sc = SCENES[i];
  // Fade each scene in and out.
  const fade = Math.min(clamp(t / 0.4), clamp((sc.dur - t) / 0.4));
  const bar = (W * time) / TOTAL;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>${glow}</defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <g opacity="${fade.toFixed(3)}">${sc.draw(t)}</g>
  <rect x="0" y="${H - 6}" width="${bar.toFixed(1)}" height="6" fill="${C.purple}" opacity="0.7"/>
  ${sc === outro ? "" : txt(W - 40, 60, "github.com/umianta/jev-vllm", { size: 22, fill: C.muted, anchor: "end", font: MONO, opacity: 0.8 })}
</svg>`;
}

// ---- rendering ---------------------------------------------------------------------------

const pad = (i: number) => String(i).padStart(5, "0");

if (opts.worker) {
  const [from, to] = opts.worker.split(":").map(Number);
  for (let f = from; f < to; f++) png(frameAt(f / FPS), join(opts.frames!, `f${pad(f)}.png`), W);
  process.exit(0);
}

mkdirSync(opts.out!, { recursive: true });

if (opts.stills) {
  for (const s of opts.stills.split(",").map(Number)) png(frameAt(s), join(opts.out!, `still-${s}.png`), W);
  console.log(`stills written to ${opts.out}`);
  process.exit(0);
}

const frames = Math.round(TOTAL * FPS);
const dir = join(opts.out!, ".frames-video");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir);
const workers = Math.max(1, Math.min(16, cpus().length - 2));
const per = Math.ceil(frames / workers);
console.log(`rendering ${frames} frames (${TOTAL}s) on ${workers} workers…`);
const procs = Array.from({ length: workers }, (_, w) =>
  Bun.spawn(["bun", import.meta.path, "--worker", `${w * per}:${Math.min(frames, (w + 1) * per)}`, "--frames", dir], { stdout: "inherit", stderr: "inherit" }));
const codes = await Promise.all(procs.map((p) => p.exited));
if (codes.some((c) => c !== 0)) throw new Error("a render worker failed");

const ffmpeg = await ffmpegPath();
const mp4 = join(opts.out!, "jev-vllm-explainer.mp4");
ff(ffmpeg, ["-framerate", `${FPS}`, "-i", join(dir, "f%05d.png"), "-c:v", "libx264", "-preset", "slow", "-crf", "18",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4]);
png(frameAt(SCENES.slice(0, 4).reduce((n, s) => n + s.dur, 0) + 8), join(opts.out!, "jev-vllm-explainer-thumbnail.png"), W);
rmSync(dir, { recursive: true, force: true });
console.log(`wrote ${mp4}`);
