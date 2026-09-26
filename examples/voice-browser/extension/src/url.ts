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
  const warning =
    u.port === "8011" || u.port === "8000"
      ? `port ${u.port} is djev/vLLM. This setting is the voice-browser server (usually ${DEFAULT_SERVER}); djev is configured on the GPU box with DJEV_URL.`
      : undefined;
  return { url: u.toString(), warning };
}
