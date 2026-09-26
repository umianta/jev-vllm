// Voice-browser server: the extension streams microphone audio and page snapshots
// over a WebSocket; this process transcribes locally, asks djev, and sends actions back.
//
//   bun server.ts
//   DJEV_URL=http://localhost:8011 WHISPER_URL=http://127.0.0.1:8178 PORT=8790 bun server.ts
//
// It binds to 127.0.0.1 by default: whoever can connect can drive your browser.
import { Djev } from "./src/djev";
import { Session } from "./src/session";
import { WhisperServer } from "./src/stt";
import type { ClientMessage, ServerMessage } from "./src/types";

const DJEV_URL = process.env.DJEV_URL ?? "http://localhost:8011";
const WHISPER_URL = process.env.WHISPER_URL ?? "http://127.0.0.1:8178";
const HOST = process.env.HOST ?? "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8790);
const SAMPLES = process.env.SAMPLES === "auto" ? "auto" : Number(process.env.SAMPLES ?? 1);

const djev = new Djev(DJEV_URL, process.env.MODEL ?? "diffusiongemma", SAMPLES);
const stt = new WhisperServer(WHISPER_URL);

const server = Bun.serve<{ session: Session }>({
  hostname: HOST,
  port: PORT,
  fetch(req, srv) {
    const { pathname } = new URL(req.url);
    if (pathname === "/ws") {
      return srv.upgrade(req, { data: { session: null as unknown as Session } })
        ? undefined
        : new Response("expected a WebSocket", { status: 400 });
    }
    if (pathname === "/health") return Response.json({ ok: true, djev: DJEV_URL, whisper: WHISPER_URL });
    return new Response("jev voice-browser server: connect the extension to ws://HOST:PORT/ws\n");
  },
  websocket: {
    open(ws) {
      const send = (m: ServerMessage) => ws.send(JSON.stringify(m));
      ws.data.session = new Session(stt, djev, send);
      send({ type: "hello", djev: DJEV_URL, whisper: WHISPER_URL });
      console.log("extension connected");
    },
    message(ws, msg) {
      if (typeof msg === "string") {
        try {
          ws.data.session.onMessage(JSON.parse(msg) as ClientMessage);
        } catch (e) {
          ws.send(JSON.stringify({ type: "error", message: `bad message: ${(e as Error).message}` }));
        }
        return;
      }
      // Copy: the buffer's byte offset may not be 2-aligned for an Int16Array view.
      const bytes = new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength - (msg.byteLength % 2)).slice();
      ws.data.session.onAudio(new Int16Array(bytes.buffer));
    },
    close() {
      console.log("extension disconnected");
    },
  },
});

console.log(`voice-browser server on ws://${server.hostname}:${server.port}/ws
  djev:    ${DJEV_URL}
  whisper: ${WHISPER_URL}`);
