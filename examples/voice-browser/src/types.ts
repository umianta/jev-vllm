// Shapes shared by the server, the policy and the extension.

/** One interactive element from the page snapshot. `id` is a single letter a–z. */
export interface PageElement {
  id: string;
  role: string; // link | button | input | textarea | select | checkbox | tab | option | item
  text: string; // visible label, ≤60 chars
}

export interface PageState {
  url: string;
  title: string;
  elements: PageElement[];
  tabs?: { index: number; title: string; active: boolean }[];
}

export interface Noul { type: "noul"; noul: number }
export interface Choice { type: "choice"; choice: string; probabilities: Record<string, number>; confidence: number }
export interface Score { type: "score"; score: number; legend: string[]; probabilities: Record<string, number>; confidence: number }
export type Answer = Noul | Choice | Score | null;

export interface Answers {
  is_command: Noul;
  complete: Noul;
  intent: Choice;
  target?: Choice | null;
  destructive: Noul;
  scroll_dir: Choice;
  scroll_amount: Score;
  tab_which: Choice;
  is_correction: Noul;
}

export type Action =
  | { kind: "open"; url: string; label: string }
  | { kind: "click"; id: string; label: string }
  | { kind: "type"; id: string; text: string; submit: boolean; label: string }
  | { kind: "scroll"; direction: "up" | "down"; amount: "little" | "page" | "end"; label: string }
  | { kind: "back" | "forward" | "reload" | "newtab" | "close"; label: string }
  | { kind: "switch"; which: "next" | "previous" | "first" | "last"; label: string }
  | { kind: "highlight"; ids: string[]; label: string };

export type Verdict =
  | { type: "act"; action: Action }
  | { type: "confirm"; action: Action; reason: string }
  | { type: "disambiguate"; candidates: string[]; reason: string }
  | { type: "wait"; reason: string }
  | { type: "ignore"; reason: string };

/** Server → extension messages. */
export type ServerMessage =
  | { type: "hello"; djev: string; whisper: string }
  | { type: "speech"; speaking: boolean }
  | { type: "transcript"; utterance: number; text: string; final: boolean; sttMs: number }
  | { type: "decision"; utterance: number; text: string; verdict: Verdict; intent: string; confidence: number; ms: number }
  | { type: "action"; utterance: number; action: Action }
  | { type: "error"; message: string };

/** Extension → server messages (audio is sent as binary Int16 PCM, 16 kHz mono). */
export type ClientMessage =
  | { type: "page"; page: PageState }
  | { type: "done"; action: Action; ok: boolean; error?: string }
  | { type: "reset" };
