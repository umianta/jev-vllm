// Spoken commands with the verdict they should produce. `final: false` checks the
// behaviour mid-sentence (the speaker has not paused yet).
import type { PageState, Verdict } from "../src/types";
import { BLANK, LOGIN, SHOP, WIKIPEDIA, YOUTUBE } from "./fixtures";

export interface Case {
  say: string;
  page: PageState;
  final?: boolean; // default true: the speaker paused
  expect: Partial<{ type: Verdict["type"]; kind: string; id: string; url: string; text: string; direction: string; amount: string; which: string }>;
}

export const CASES: Case[] = [
  // open
  { say: "open youtube", page: BLANK, expect: { type: "act", kind: "open", url: "https://www.youtube.com/" } },
  { say: "go to wikipedia", page: YOUTUBE, expect: { type: "act", kind: "open", url: "https://en.wikipedia.org/" } },
  { say: "take me to news dot ycombinator dot com", page: BLANK, expect: { type: "act", kind: "open", url: "https://news.ycombinator.com/" } },
  { say: "can you open github for me", page: WIKIPEDIA, expect: { type: "act", kind: "open", url: "https://github.com/" } },

  // search
  { say: "search for lofi music", page: YOUTUBE, expect: { type: "act", kind: "open", url: "https://www.youtube.com/results?search_query=lofi%20music" } },
  { say: "look up the enigma machine on wikipedia", page: BLANK, expect: { type: "act", kind: "open", url: "https://en.wikipedia.org/w/index.php?search=the%20enigma%20machine" } },
  { say: "find cheap flights to lisbon", page: BLANK, expect: { type: "act", kind: "open", url: "https://duckduckgo.com/?q=cheap%20flights%20to%20lisbon" } },
  { say: "search for", page: YOUTUBE, final: false, expect: { type: "wait" } },
  { say: "search for lofi", page: YOUTUBE, final: false, expect: { type: "wait" } },

  // click, by description
  { say: "click the rust video", page: YOUTUBE, expect: { type: "act", kind: "click", id: "k" } },
  { say: "play the one about transformers", page: YOUTUBE, expect: { type: "act", kind: "click", id: "h" } },
  { say: "open the starship launch", page: YOUTUBE, expect: { type: "act", kind: "click", id: "j" } },
  { say: "watch the scrambled eggs video", page: YOUTUBE, expect: { type: "act", kind: "click", id: "i" } },
  { say: "go to shorts", page: YOUTUBE, expect: { type: "act", kind: "click", id: "b" } },
  { say: "click sign in", page: YOUTUBE, expect: { type: "act", kind: "click", id: "l" } },
  { say: "open the enigma machine link", page: WIKIPEDIA, expect: { type: "act", kind: "click", id: "j" } },
  { say: "show me the article about the turing machine", page: WIKIPEDIA, expect: { type: "act", kind: "click", id: "i" } },
  { say: "view history", page: WIKIPEDIA, expect: { type: "act", kind: "click", id: "f" } },
  { say: "click the talk page", page: WIKIPEDIA, expect: { type: "act", kind: "click", id: "d" } },
  { say: "click the rust video", page: YOUTUBE, final: false, expect: { type: "act", kind: "click", id: "k" } }, // acts mid-sentence
  { say: "click forgot password", page: LOGIN, expect: { type: "act", kind: "click", id: "c" } },

  // type
  { say: "type octocat in the username field", page: LOGIN, expect: { type: "act", kind: "type", id: "a", text: "octocat" } },
  { say: "enter SAVE10 into the promo code box", page: SHOP, expect: { type: "act", kind: "type", id: "b", text: "SAVE10" } },

  // scroll and navigation
  { say: "scroll down", page: WIKIPEDIA, expect: { type: "act", kind: "scroll", direction: "down" } },
  { say: "scroll up a little", page: WIKIPEDIA, expect: { type: "act", kind: "scroll", direction: "up", amount: "little" } },
  { say: "go all the way to the bottom", page: WIKIPEDIA, expect: { type: "act", kind: "scroll", direction: "down", amount: "end" } },
  { say: "go back", page: WIKIPEDIA, expect: { type: "act", kind: "back" } },
  { say: "go forward", page: WIKIPEDIA, expect: { type: "act", kind: "forward" } },
  { say: "refresh the page", page: YOUTUBE, expect: { type: "act", kind: "reload" } },
  { say: "open a new tab", page: YOUTUBE, expect: { type: "act", kind: "newtab" } },
  { say: "close this tab", page: YOUTUBE, expect: { type: "act", kind: "close" } },
  { say: "switch to the next tab", page: YOUTUBE, expect: { type: "act", kind: "switch", which: "next" } },
  { say: "go to the previous tab", page: YOUTUBE, expect: { type: "act", kind: "switch", which: "previous" } },

  // safety and non-commands
  { say: "place the order", page: SHOP, expect: { type: "confirm", kind: "click", id: "f" } },
  { say: "remove the headphones from my cart", page: SHOP, expect: { type: "confirm", kind: "click", id: "d" } },
  { say: "honey did you feed the cat", page: YOUTUBE, expect: { type: "ignore" } },
  { say: "I think that video was really good", page: YOUTUBE, expect: { type: "ignore" } },
  { say: "click the", page: YOUTUBE, final: false, expect: { type: "wait" } },
];
