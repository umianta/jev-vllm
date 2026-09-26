import { describe, expect, test } from "bun:test";
import { DEFAULT_SERVER, normalizeServer } from "../extension/src/url";

describe("normalizeServer", () => {
  test.each([
    ["", DEFAULT_SERVER],
    ["ws://localhost:8790/ws", "ws://localhost:8790/ws"],
    ["http://localhost:8790", "ws://localhost:8790/ws"],
    ["localhost:8790", "ws://localhost:8790/ws"],
    ["https://gpu.example.com", "wss://gpu.example.com/ws"],
  ])("%p → %p", (input, url) => expect(normalizeServer(input)).toEqual({ url }));

  test("corrects djev's port to the voice-browser server", () => {
    const r = normalizeServer("http://localhost:8011");
    expect(r.url).toBe("ws://localhost:8790/ws");
    expect(r.warning).toContain("DJEV_URL");
  });
});
