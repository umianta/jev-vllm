// The typed questions asked about every (partial) transcript, and the state they read.
// One /v1/systemone request answers all of them in a joint read.
import type { PageState } from "./types";

export const INTENTS: Record<string, string> = {
  open: "go to a website or web address",
  search: "search for something",
  click: "click, press, open or select a link, button or item on the current page",
  type: "type or enter text into a field on the current page",
  scroll: "scroll the page up or down",
  back: "go back to the previous page",
  forward: "go forward to the next page in history",
  reload: "reload or refresh the page",
  tab: "open a new empty tab",
  close: "close the current tab",
  switch: "switch to another open tab",
  none: "none of these, or not a browser command",
};

export function buildState(transcript: string, page: PageState, recent: string[]) {
  return {
    transcript,
    page: { url: page.url, title: page.title },
    elements: page.elements.map((e) => `${e.id}: ${e.role} "${e.text}"`).join("\n") || "(none)",
    recent_actions: recent.length ? recent.join("; ") : "(none)",
  };
}

export function buildQuestions(page: PageState) {
  const q: Record<string, unknown> = {
    is_command: {
      type: "noul",
      instructions:
        "Is the transcript an instruction for the web browser (as opposed to talking to another person, thinking aloud or background speech)?",
    },
    complete: {
      type: "noul",
      instructions:
        "Is the spoken command complete, with nothing important still missing? A search needs its search words, a click needs what to click, an open needs the site.",
    },
    intent: {
      type: "choice",
      instructions: "Which browser action does the transcript ask for?",
      criteria: INTENTS,
    },
    destructive: {
      type: "noul",
      instructions: "Would doing this buy, pay, delete, send, post or submit something?",
    },
    scroll_dir: {
      type: "choice",
      instructions: "If scrolling, which direction?",
      criteria: { down: "down, further into the page", up: "up, towards the top" },
    },
    scroll_amount: {
      type: "score",
      instructions: "If scrolling, how far?",
      criteria: ["little", "page", "end"],
    },
    tab_which: {
      type: "choice",
      instructions: "If switching tabs, which tab?",
      criteria: { next: "the next tab", previous: "the previous tab", first: "the first tab", last: "the last tab" },
    },
    is_correction: {
      type: "noul",
      instructions:
        "Is the speaker rejecting or correcting the most recent action in recent_actions (for example 'no, the other one' or 'undo that')?",
    },
  };
  // A choice needs at least two options; ids are single letters, so each is one token.
  if (page.elements.length >= 2) {
    q.target = {
      type: "choice",
      instructions:
        "Which page element does the speaker mean? Match their words to an element's label or role. They may also say the element's letter.",
      criteria: Object.fromEntries(page.elements.map((e) => [e.id, `${e.role} "${e.text}"`])),
    };
  }
  return q;
}
