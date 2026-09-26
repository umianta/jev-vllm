// The voice-control window: streams the mic to the server, keeps it updated with a
// snapshot of the active tab, and carries out the actions it sends back.
import type { Action, ClientMessage, PageState, ServerMessage, Verdict } from "../../src/types";
import { runPageAction, snapshotPage } from "./page";
import { DEFAULT_SERVER, normalizeServer } from "./url";

const SNAPSHOT_EVERY_MS = 1500;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const ui = {
  mic: $<HTMLButtonElement>("mic"),
  conn: $("conn"),
  connText: $("connText"),
  speaking: $("speaking"),
  transcript: $("transcript"),
  verdict: $("verdict"),
  timing: $("timing"),
  log: $<HTMLOListElement>("log"),
  server: $<HTMLInputElement>("server"),
};

let ws: WebSocket | null = null;
let audio: { ctx: AudioContext; stream: MediaStream } | null = null;
let lastSttMs = 0;

// ---- server connection -------------------------------------------------------

function send(m: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
}

function connect() {
  ws?.close();
  const { url, warning } = normalizeServer(ui.server.value);
  ui.server.value = url;
  if (warning) showVerdict("error", warning);
  ws = new WebSocket(url);
  ws.binaryType = "arraybuffer";
  ws.onopen = () => {
    setConn(true, "connected");
    void refreshPage();
  };
  ws.onclose = () => {
    setConn(false, "disconnected, retrying…");
    setTimeout(() => ws?.readyState === WebSocket.CLOSED && connect(), 2000);
  };
  ws.onmessage = (e) => onServer(JSON.parse(e.data as string) as ServerMessage);
}

function setConn(on: boolean, text: string) {
  ui.conn.classList.toggle("on", on);
  ui.connText.textContent = text;
}

// ---- microphone ------------------------------------------------------------

async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  // Chrome resamples the mic to the context rate, so frames arrive at 16 kHz.
  const ctx = new AudioContext({ sampleRate: 16_000 });
  await ctx.audioWorklet.addModule("worklet.js");
  const node = new AudioWorkletNode(ctx, "pcm-framer");
  node.port.onmessage = (e) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(e.data as ArrayBuffer);
  };
  ctx.createMediaStreamSource(stream).connect(node);
  audio = { ctx, stream };
}

function stopMic() {
  audio?.stream.getTracks().forEach((t) => t.stop());
  void audio?.ctx.close();
  audio = null;
}

ui.mic.onclick = async () => {
  if (audio) {
    stopMic();
  } else {
    try {
      await startMic();
    } catch (e) {
      showVerdict("error", `microphone: ${(e as Error).message}`);
      return;
    }
  }
  ui.mic.setAttribute("aria-pressed", String(!!audio));
  ui.mic.textContent = audio ? "Stop listening" : "Start listening";
};

// ---- the controlled tab --------------------------------------------------------

async function targetTab(): Promise<chrome.tabs.Tab | undefined> {
  const win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ["normal"] });
  return win.tabs?.find((t) => t.active);
}

async function refreshPage() {
  const tab = await targetTab();
  if (!tab?.id) return;
  let page: PageState = { url: tab.url ?? "", title: tab.title ?? "", elements: [] };
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: snapshotPage });
    if (res?.result) page = res.result as PageState;
  } catch {
    // chrome:// pages and the Web Store can't be scripted; navigation still works.
  }
  const tabs = await chrome.tabs.query({ windowId: tab.windowId });
  page.tabs = tabs.map((t) => ({ index: t.index, title: t.title ?? "", active: !!t.active }));
  send({ type: "page", page });
}

chrome.tabs.onActivated.addListener(() => void refreshPage());
chrome.tabs.onUpdated.addListener((_id, info) => info.status === "complete" && void refreshPage());
chrome.windows.onFocusChanged.addListener(() => void refreshPage());
setInterval(() => void refreshPage(), SNAPSHOT_EVERY_MS);

async function perform(action: Action): Promise<{ ok: boolean; error?: string }> {
  const tab = await targetTab();
  if (!tab?.id) return { ok: false, error: "no active tab" };
  const id = tab.id;
  switch (action.kind) {
    case "open":
      await chrome.tabs.update(id, { url: action.url });
      return { ok: true };
    case "back":
      await chrome.tabs.goBack(id);
      return { ok: true };
    case "forward":
      await chrome.tabs.goForward(id);
      return { ok: true };
    case "reload":
      await chrome.tabs.reload(id);
      return { ok: true };
    case "newtab":
      await chrome.tabs.create({ windowId: tab.windowId });
      return { ok: true };
    case "close":
      await chrome.tabs.remove(id);
      return { ok: true };
    case "switch": {
      const tabs = await chrome.tabs.query({ windowId: tab.windowId });
      const i = tab.index;
      const n = tabs.length;
      const to = { next: (i + 1) % n, previous: (i - 1 + n) % n, first: 0, last: n - 1 }[action.which];
      const t = tabs.find((x) => x.index === to);
      if (t?.id) await chrome.tabs.update(t.id, { active: true });
      return { ok: true };
    }
    default: {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: id }, func: runPageAction, args: [action] });
      return (res?.result as { ok: boolean; error?: string }) ?? { ok: false, error: "no result" };
    }
  }
}

// ---- server messages → UI and actions ---------------------------------------

function showVerdict(kind: string, text: string) {
  ui.verdict.className = `verdict ${kind}`;
  ui.verdict.textContent = text;
}

function describe(v: Verdict): string {
  switch (v.type) {
    case "act": return `→ ${v.action.label}`;
    case "confirm": return `? ${v.action.label}: ${v.reason}`;
    case "disambiguate": return `? ${v.reason} (${v.candidates.join(", ")})`;
    case "wait": return `… ${v.reason}`;
    case "ignore": return `✕ ${v.reason}`;
  }
}

function log(text: string, ms: string) {
  const li = document.createElement("li");
  const a = document.createElement("span");
  a.textContent = text;
  const b = document.createElement("span");
  b.className = "ms";
  b.textContent = ms;
  li.append(a, b);
  ui.log.prepend(li);
  while (ui.log.children.length > 40) ui.log.lastChild!.remove();
}

async function onServer(m: ServerMessage) {
  switch (m.type) {
    case "hello":
      setConn(true, "connected");
      break;
    case "speech":
      ui.speaking.hidden = !m.speaking;
      break;
    case "transcript":
      lastSttMs = m.sttMs;
      ui.transcript.textContent = m.text;
      ui.transcript.classList.toggle("partial", !m.final);
      break;
    case "decision":
      showVerdict(m.verdict.type, describe(m.verdict));
      ui.timing.textContent = `speech-to-text ${lastSttMs} ms · decision ${m.ms} ms · ${m.intent} ${Math.round(m.confidence * 100)}%`;
      if (m.verdict.type !== "wait") log(`“${m.text}” ${describe(m.verdict)}`, `${m.ms} ms`);
      break;
    case "action": {
      const result = await perform(m.action);
      if (m.action.kind !== "highlight") send({ type: "done", action: m.action, ok: result.ok, error: result.error });
      if (!result.ok) showVerdict("error", `${m.action.label} failed: ${result.error}`);
      setTimeout(() => void refreshPage(), 700);
      break;
    }
    case "error":
      showVerdict("error", m.message);
      break;
  }
}

// ---- settings ----------------------------------------------------------------

const stored = await chrome.storage.local.get("server");
ui.server.value = (stored.server as string) ?? DEFAULT_SERVER;
ui.server.onchange = () => {
  connect(); // normalizes the field first
  void chrome.storage.local.set({ server: ui.server.value });
};
connect();
