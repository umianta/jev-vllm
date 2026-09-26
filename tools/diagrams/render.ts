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
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ff, ffmpegPath, flatten, freeze, nest, png as pngAt, SANS, type Theme } from "./lib";

const { values: opts } = parseArgs({
  options: {
    theme: { type: "string", default: "both" },
    docs: { type: "string", default: resolve(import.meta.dir, "../../docs") },
    out: { type: "string", default: resolve(import.meta.dir, "../../docs/social") },
  },
});

const W = 1920, H = 1080, FPS = 30, CYCLE = 6;
const FRAME = {
  dark: { bg: "#0d1117", fg: "#e6edf3", muted: "#9198a1" },
  light: { bg: "#ffffff", fg: "#1f2328", muted: "#59636e" },
};

// Place the diagram in a 16:9 frame with a title, centred vertically.
function frame(inner: string, theme: Theme, title: string, subtitle: string) {
  const c = FRAME[theme];
  const vb = inner.match(/viewBox="0 0 (\d+) (\d+)"/)!;
  const ih = Math.round((1800 * +vb[2]) / +vb[1]);
  const y0 = Math.round((H - (200 + ih)) / 2);
  const { body } = nest(inner, 60, y0 + 200, 1800);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${c.bg}"/>
  <text x="${W / 2}" y="${y0 + 58}" text-anchor="middle" font-family="${SANS}" font-weight="700" font-size="58" fill="${c.fg}">${title}</text>
  <text x="${W / 2}" y="${y0 + 123}" text-anchor="middle" font-family="${SANS}" font-size="30" fill="${c.muted}">${subtitle}</text>
  ${body}
</svg>`;
}

const png = (svg: string, path: string) => pngAt(svg, path, W);

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
