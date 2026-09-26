import { describe, expect, test } from "bun:test";
import { resolveSite, searchUrl } from "../src/sites";
import { confirmation, searchSpan, siteSpan, typeSpan } from "../src/spans";

describe("siteSpan", () => {
  test.each([
    ["open youtube", "youtube"],
    ["Open YouTube.", "YouTube"],
    ["can you go to wikipedia please", "wikipedia"],
    ["go to news dot ycombinator dot com", "news.ycombinator.com"],
    ["take me to the github website", "github"],
    ["hey browser, open hacker news", "hacker news"],
  ])("%p → %p", (said, site) => expect(siteSpan(said)).toBe(site));

  test("not an open command", () => expect(siteSpan("scroll down")).toBeNull());
});

describe("searchSpan", () => {
  test.each([
    ["search for lofi music", "lofi music", null],
    ["search for lofi music on youtube", "lofi music", "youtube"],
    ["Look up the Turing test on Wikipedia.", "the Turing test", "wikipedia"],
    ["find me cheap flights to Lisbon", "cheap flights to Lisbon", null],
    ["what is a transformer model", "what is a transformer model", null],
    ["google how to boil an egg", "how to boil an egg", null],
    ["such for love in magic on YouTube", "love in magic", "youtube"], // "search" misheard, seen in a real session
  ])("%p → %p on %p", (said, text, site) => expect(searchSpan(said)).toEqual({ text, site }));

  test("nothing to search", () => expect(searchSpan("search for")).toBeNull());
});

describe("typeSpan", () => {
  test.each([
    ["type hello world", "hello world"],
    ["type hello world in the search box", "hello world"],
    ["enter octocat into the username field", "octocat"],
    ["write 'meeting at noon'", "meeting at noon"],
  ])("%p → %p", (said, text) => expect(typeSpan(said)).toBe(text));
});

describe("confirmation", () => {
  test.each([
    ["confirm", "confirm"],
    ["yes do it", "confirm"],
    ["no cancel that", "cancel"],
    ["never mind", "cancel"],
    ["scroll down", null],
  ])("%p → %p", (said, want) => expect(confirmation(said)).toBe(want as never));
});

describe("sites", () => {
  test("known names", () => {
    expect(resolveSite("YouTube")).toBe("https://www.youtube.com/");
    expect(resolveSite("hacker news")).toBe("https://news.ycombinator.com/");
  });
  test("domains", () => expect(resolveSite("example.org/docs")).toBe("https://example.org/docs"));
  test("known domains use the known URL", () => expect(resolveSite("news.ycombinator.com")).toBe("https://news.ycombinator.com/"));
  test("unknown names jump to the first result", () => expect(resolveSite("the verge")).toContain("duckduckgo.com/?q=!"));
  test("search on the named site", () =>
    expect(searchUrl("lofi music", "youtube", "https://example.com")).toBe("https://www.youtube.com/results?search_query=lofi%20music"));
  test("search on the current site", () =>
    expect(searchUrl("enigma", null, "https://en.wikipedia.org/wiki/Alan_Turing")).toBe("https://en.wikipedia.org/w/index.php?search=enigma"));
  test("fallback search", () => expect(searchUrl("x y", null, "chrome://newtab/")).toBe("https://duckduckgo.com/?q=x%20y"));
});
