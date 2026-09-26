// Normalize what people type into the Server setting.
export const DEFAULT_SERVER = "ws://localhost:8790/ws";

export interface ServerUrl {
  url: string;
  warning?: string;
}

/** "http://localhost:8790" → "ws://localhost:8790/ws"; warns about djev's port. */
export function normalizeServer(input: string): ServerUrl {
  let raw = input.trim() || DEFAULT_SERVER;
  if (!/^[a-z]+:\/\//i.test(raw)) raw = `ws://${raw}`;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: DEFAULT_SERVER, warning: `"${input}" is not a URL; using ${DEFAULT_SERVER}` };
  }
  if (u.protocol === "http:") u.protocol = "ws:";
  if (u.protocol === "https:") u.protocol = "wss:";
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/ws";
  // djev (8011) and vLLM (8000) are never the right target here: the voice-browser
  // server reaches djev itself (DJEV_URL on the GPU box). Correct it instead of failing.
  if (u.port === "8011" || u.port === "8000") {
    const was = u.port;
    u.port = "8790";
    return {
      url: u.toString(),
      warning: `Server was set to port ${was} (djev/vLLM); changed to the voice-browser server on 8790. djev is set on the GPU box with DJEV_URL.`,
    };
  }
  return { url: u.toString() };
}
