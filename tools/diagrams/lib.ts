// Shared by render.ts (diagram renders) and video.ts (the explainer video):
// flatten an SVG's theme, step its SMIL animation to a time, rasterize, encode.
import { Resvg } from "@resvg/resvg-js";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { writeFileSync } from "node:fs";

export const SANS = "Roboto, Inter, Helvetica, Arial, DejaVu Sans, sans-serif";
export const MONO = "DejaVu Sans Mono, Ubuntu Sans Mono, Menlo, monospace";
export type Theme = "dark" | "light";

export async function ffmpegPath() {
  if (process.env.FFMPEG) return process.env.FFMPEG;
  const system = Bun.which("ffmpeg");
  if (system) return system;
  return (await import("@ffmpeg-installer/ffmpeg")).default.path as string;
}

export function ff(bin: string, args: string[]) {
  const p = Bun.spawnSync([bin, "-y", "-loglevel", "error", ...args]);
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed: ${p.stderr.toString()}`);
}

function vars(block: string) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

/** resvg has no CSS custom properties or media queries: pick one theme's tokens and inline them. */
export function flatten(svg: string, theme: Theme) {
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

/**
 * Evaluate the SMIL subset the diagrams use at time t: numeric <animate>, and
 * <animateMotion> along a straight "M x,y H x2" path.
 */
export function freeze(svg: string, t: number) {
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

/** Resize an SVG document so it can be nested at (x, y) with the given width. */
export function nest(svg: string, x: number, y: number, width: number) {
  const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/)!;
  const height = Math.round((width * +vb[2]) / +vb[1]);
  const body = svg
    .replace(/<\?xml[^>]*>/, "")
    .replace(/<svg([^>]*?)width="\d+" height="\d+"/, `<svg$1x="${x}" y="${y}" width="${width}" height="${height}"`);
  return { body, height };
}

export function png(svg: string, path: string, width: number) {
  const r = new Resvg(svg, { font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans" }, fitTo: { mode: "width", value: width } });
  writeFileSync(path, r.render().asPng());
}
