// Pull the verbatim parts of a command (site name, search words, text to type) out of
// the transcript with plain rules. The model decides *what* to do; copying words is
// cheaper and more exact in code than as model span questions.

const POLITE = /^(?:(?:hey |ok |okay )?(?:browser|jev)[,.]?\s+)?(?:(?:can|could|would) you\s+|please\s+|now\s+|and\s+|then\s+)*/i;
const TRAILING = /[\s,.!?]*(?:please|thanks|thank you|for me|now)?[\s,.!?]*$/i;

const OPEN = /^(?:open(?: up)?|go to|goto|visit|navigate to|take me to|bring up|load|pull up)\s+(?:the\s+)?(?:web\s?site\s+|page\s+|site\s+)?/i;
const SEARCH =
  /^(?:(?:search|google|look)(?: up| for| up for)?|find(?: me)?|look up|show me(?: some)?|what(?:'s| is| are)|who(?:'s| is| was)|how (?:do|to|does|did))\s+/i;
const SEARCH_ON = /\s+(?:on|in|at)\s+(youtube|wikipedia|github|amazon|reddit|google|duckduckgo|maps|google maps)$/i;
const TYPE = /^(?:type|enter|write|put|fill in|input)(?:\s+in)?\s+/i;
const TYPE_TARGET = /\s+(?:in|into|in the|into the)\s+(?:the\s+)?[\w\s]{1,30}?(?:box|field|bar|input)?$/i;

function clean(t: string) {
  return t.replace(POLITE, "").replace(TRAILING, "").trim();
}

function unquote(t: string) {
  return t.replace(/^["'“”‘’]+|["'“”‘’.,!?]+$/g, "").trim();
}

/** "open youtube please" → "youtube"; "go to news dot ycombinator dot com" → "news.ycombinator.com" */
export function siteSpan(transcript: string): string | null {
  const t = clean(transcript);
  if (!OPEN.test(t)) return null;
  const rest = t.replace(OPEN, "").replace(/\s+(?:dot)\s+/gi, ".").replace(/\s+(?:website|site|page|homepage)$/i, "");
  return unquote(rest) || null;
}

/** "search for lofi music on youtube" → { text: "lofi music", site: "youtube" } */
export function searchSpan(transcript: string): { text: string; site: string | null } | null {
  let t = clean(transcript);
  let site: string | null = null;
  const on = t.match(SEARCH_ON);
  if (on) {
    site = on[1].toLowerCase();
    t = t.slice(0, on.index).trim();
  }
  const text = unquote(t.replace(SEARCH, ""));
  // Question forms ("what is X", "who was X") keep their question words for the search.
  const q = t.match(/^(what(?:'s| is| are)|who(?:'s| is| was)|how (?:do|to|does|did))\s+/i);
  const out = q ? unquote(t) : text;
  // "search for" with nothing after it: the leftover is just a filler word.
  if (!out || /^(for|up|me|about|on)$/i.test(out)) return null;
  return { text: out, site };
}

/** "type hello world in the search box" → "hello world" */
export function typeSpan(transcript: string): string | null {
  const t = clean(transcript);
  if (!TYPE.test(t)) return null;
  return unquote(t.replace(TYPE, "").replace(TYPE_TARGET, "")) || null;
}

const CONFIRM = /\b(confirm(ed)?|yes|yeah|yep|do it|go ahead|sure)\b/i;
const CANCEL = /\b(cancel|no|nope|stop|don'?t|never ?mind|abort)\b/i;

export function confirmation(transcript: string): "confirm" | "cancel" | null {
  if (CANCEL.test(transcript)) return "cancel";
  if (CONFIRM.test(transcript)) return "confirm";
  return null;
}
