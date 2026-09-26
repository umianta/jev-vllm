// Render the README diagrams (docs/arch.svg, docs/inference.svg) into
// PNG / MP4 / GIF for places that don't take SVG, such as LinkedIn.
//
//   cd tools/diagrams && bun install
//   bun render.ts                 # dark + light into docs/social/
//   bun render.ts --theme dark    # one theme only
//
// The SVGs stay the source of truth: this script inlines their CSS theme
// variables, steps their SMIL animations to each frame time, rasterizes with
// resvg and encodes with ffmpeg (system ffmpeg, $FFMPEG, or the bundled one).
import { Resvg } from "@resvg/resvg-js";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const { values: opts } = parseArgs({
  options: {
    theme: { type: "string", default: "both" },
    docs: { type: "string", default: resolve(import.meta.dir, "../../docs") },
    out: { type: "string", default: resolve(import.meta.dir, "../../docs/social") },
  },
});

const W = 1920, H = 1080, FPS = 30, CYCLE = 6;
const SANS = "Roboto, Inter, Helvetica, Arial, DejaVu Sans, sans-serif";
const MONO = "Ubuntu Sans Mono, JetBrains Mono, Menlo, DejaVu Sans Mono, monospace";
const FRAME = {
  dark: { bg: "#0d1117", fg: "#e6edf3", muted: "#9198a1" },
  light: { bg: "#ffffff", fg: "#1f2328", muted: "#59636e" },
};
type Theme = keyof typeof FRAME;

async function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const system = Bun.which("ffmpeg");
  if (system) return system;
  return (await import("@ffmpeg-installer/ffmpeg")).default.path as string;
}

function vars(block: string) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

// resvg has no CSS custom properties or media queries: pick one theme's tokens and inline them.
function flatten(svg: string, theme: Theme) {
  const light = vars(svg.match(/:root\s*{([^}]*)}/)![1]);
  const dark = vars(svg.match(/@media[^{]*{\s*:root\s*{([^}]*)}\s*}/)![1]);
  const v = theme === "dark" ? { ...light, ...dark } : light;
  return svg
    .replace(/@media[^{]*{\s*:root\s*{[^}]*}\s*}/, "")
    .replace(/:root\s*{[^}]*}/, "")
    .replace(/var\(--([\w-]+)\)/g, (_, k) => v[k])
    .replace(/ui-monospace, SFMono-Regular, Menlo, monospace/g, MONO)
    .replace(/ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif/g, SANS);
}

const list = (s: string | null) => (s ? s.split(";").map(parseFloat) : null);

function interp(values: number[], keyTimes: number[] | null, p: number) {
  const kt = keyTimes ?? values.map((_, i) => i / (values.length - 1));
  for (let i = 0; i < kt.length - 1; i++) {
    if (p >= kt[i] && p <= kt[i + 1]) {
      const span = kt[i + 1] - kt[i];
      return values[i] + (values[i + 1] - values[i]) * (span === 0 ? 1 : (p - kt[i]) / span);
    }
  }
  return values[values.length - 1];
}

// Evaluate the SMIL subset the diagrams use at time t: numeric <animate>, and
// <animateMotion> along a straight "M x,y H x2" path.
function freeze(svg: string, t: number) {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  for (const tag of ["animate", "animateMotion"]) {
    for (const a of Array.from(doc.getElementsByTagName(tag))) {
      const dur = parseFloat(a.getAttribute("dur")!);
      const p = (t % dur) / dur;
      const parent = a.parentNode as any;
      if (tag === "animate") {
        const val = interp(list(a.getAttribute("values"))!, list(a.getAttribute("keyTimes")), p);
        parent.setAttribute(a.getAttribute("attributeName")!, val.toFixed(3));
      } else {
        const m = a.getAttribute("path")!.match(/M\s*([\d.]+),([\d.]+)\s*H\s*([\d.]+)/);
        if (!m) throw new Error(`unsupported animateMotion path: ${a.getAttribute("path")}`);
        const [x0, y0, x1] = m.slice(1).map(Number);
        const k = interp(list(a.getAttribute("keyPoints"))!, list(a.getAttribute("keyTimes")), p);
        parent.setAttribute("transform", `translate(${(x0 + (x1 - x0) * k).toFixed(2)},${y0})`);
      }
      parent.removeChild(a);
    }
  }
  return new XMLSerializer().serializeToString(doc);
}

// Place the diagram in a 16:9 frame with a title, centred vertically.
function frame(inner: string, theme: Theme, title: string, subtitle: string) {
  const c = FRAME[theme];
  const vb = inner.match(/viewBox="0 0 (\d+) (\d+)"/)!;
  const iw = 1800, ih = Math.round((iw * +vb[2]) / +vb[1]);
  const y0 = Math.round((H - (200 + ih)) / 2);
  const body = inner
    .replace(/<\?xml[^>]*>/, "")
    .replace(/<svg([^>]*?)width="\d+" height="\d+"/, `<svg$1x="60" y="${y0 + 200}" width="${iw}" height="${ih}"`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <text x="${W / 2}" y="${y0 + 58}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="58" fill="${c.fg}">${title}</text>
  <text x="${W / 2}" y="${y0 + 123}" text-anchor="middle" font-family="${SANS}" font-size="30" fill="${c.muted}">${subtitle}</text>
  ${body}
</svg>`;
}

function png(svg: string, path: string) {
  const r = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" }, fitTo: { mode: "width", value: W } });
  writeFileSync(path, r.render().asPng());
}

function ff(bin: string, args: string[]) {
  const p = Bun.spawnSync([bin, "-y", "-loglevel", "error", ...args]);
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed: ${p.stderr.toString()}`);
}

async function render(theme: Theme, ffmpeg: string) {
  const out = opts.out!;
  const arch = flatten(readFileSync(join(opts.docs!, "arch.svg"), "utf8"), theme);
  png(frame(arch, theme, "djev + DiffusionGemma on vLLM", "Structured System One reads on a single GB10 GPU"),
    join(out, `architecture-${theme}.png`));

  const inf = flatten(readFileSync(join(opts.docs!, "inference.svg"), "utf8"), theme);
  const T = "One inference step";
  const S = "djev seeds the canvas · the GPU runs one denoise step · label-token probabilities come back";
  const tmp = join(out, `.frames-${theme}`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp);
  // Two loops so the video clears LinkedIn's 3 s minimum comfortably and reads as a loop.
  for (let i = 0; i < FPS * CYCLE * 2; i++) {
    png(frame(freeze(inf, i / FPS), theme, T, S), join(tmp, `f${String(i).padStart(4, "0")}.png`));
  }
  png(frame(freeze(inf, 5.3), theme, T, S), join(out, `inference-poster-${theme}.png`));

  const input = ["-framerate", `${FPS}`, "-i", join(tmp, "f%04d.png")];
  ff(ffmpeg, [...input, "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", join(out, `inference-${theme}.mp4`)]);
  ff(ffmpeg, [...input, "-frames:v", `${FPS * CYCLE}`, "-vf",
    "fps=15,scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
    "-loop", "0", join(out, `inference-${theme}.gif`)]);
  rmSync(tmp, { recursive: true, force: true });
  console.log(`${theme}: wrote ${out}`);
}

const themes: Theme[] = opts.theme === "both" ? ["dark", "light"] : [opts.theme as Theme];
if (!themes.every((t) => t in FRAME)) throw new Error(`--theme must be dark, light or both`);
mkdirSync(opts.out!, { recursive: true });
const ffmpeg = await ffmpegPath();
for (const t of themes) await render(t, ffmpeg);
