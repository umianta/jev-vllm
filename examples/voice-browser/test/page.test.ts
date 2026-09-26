// The injected page functions, run the way Chrome runs them: re-created from their
// source text alone, so any reference to module scope would fail here too.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { runPageAction, snapshotPage } from "../extension/src/page";

beforeAll(() => GlobalRegistrator.register({ width: 1280, height: 800 }));
afterAll(() => GlobalRegistrator.unregister());

// Serialize and rebuild, as chrome.scripting.executeScript does.
const isolate = <F extends (...a: never[]) => unknown>(f: F): F => new Function(`return (${f.toString()})`)() as F;

function layout() {
  // happy-dom has no layout: give each element a box from its data-y attribute.
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const y = Number(this.getAttribute("data-y") ?? -1000);
    const h = Number(this.getAttribute("data-h") ?? 30);
    return { top: y, bottom: y + h, left: 10, right: 310, width: 300, height: h, x: 10, y } as DOMRect;
  };
}

describe("snapshotPage", () => {
  test("labels visible interactive elements in reading order", () => {
    layout();
    document.body.innerHTML = `
      <input data-y="10" placeholder="Search">
      <button data-y="10" aria-label="Voice search"></button>
      <a href="/v/1" data-y="100" data-h="120">How transformers work</a>
      <a href="/v/1" data-y="230">How transformers work</a>
      <a href="/v/2" data-y="400">Learn Rust in 30 minutes</a>
      <a href="/v/3" data-y="5000">Below the fold</a>
      <button data-y="60" disabled>Disabled</button>
      <button data-y="70" style="display:none">Hidden</button>
      <div role="button" data-y="80">Custom</div>`;
    const page = isolate(snapshotPage)();
    expect(page.elements).toEqual([
      { id: "a", role: "input", text: "Search" },
      { id: "b", role: "button", text: "Voice search" },
      { id: "c", role: "button", text: "Custom" },
      { id: "d", role: "link", text: "How transformers work" },
      { id: "e", role: "link", text: "Learn Rust in 30 minutes" },
    ]);
    expect(document.querySelector('[data-jev-id="e"]')?.textContent).toBe("Learn Rust in 30 minutes");
  });

  test("keeps at most 26, preferring fields and large elements", () => {
    layout();
    const links = Array.from({ length: 40 }, (_, i) => `<a href="/${i}" data-y="${20 + i * 15}" data-h="${i < 20 ? 10 : 80}">item ${i}</a>`);
    document.body.innerHTML = `<input data-y="1" placeholder="q">${links.join("")}`;
    const page = isolate(snapshotPage)();
    expect(page.elements).toHaveLength(26);
    expect(page.elements[0]).toMatchObject({ role: "input", text: "q" });
    expect(page.elements.filter((e) => Number(e.text.split(" ")[1]) >= 20)).toHaveLength(20);
  });
});

describe("runPageAction", () => {
  test("click", () => {
    layout();
    document.body.innerHTML = `<button data-y="10">Go</button>`;
    let clicked = 0;
    document.querySelector("button")!.addEventListener("click", () => clicked++);
    isolate(snapshotPage)();
    const r = isolate(runPageAction)({ kind: "click", id: "a", label: "click Go" });
    expect(r).toEqual({ ok: true });
    expect(clicked).toBe(1);
  });

  test("type fires input events and submits the form", () => {
    layout();
    document.body.innerHTML = `<form><input data-y="10" placeholder="Search"></form>`;
    const input = document.querySelector("input")!;
    let inputs = 0;
    let submitted = 0;
    input.addEventListener("input", () => inputs++);
    document.querySelector("form")!.addEventListener("submit", (e) => { e.preventDefault(); submitted++; });
    isolate(snapshotPage)();
    const r = isolate(runPageAction)({ kind: "type", id: "a", text: "lofi music", submit: true, label: "type" });
    expect(r).toEqual({ ok: true });
    expect(input.value).toBe("lofi music");
    expect(inputs).toBe(1);
    expect(submitted).toBe(1);
  });

  test("missing element reports an error instead of throwing", () => {
    layout();
    document.body.innerHTML = "";
    expect(isolate(runPageAction)({ kind: "click", id: "z", label: "x" })).toMatchObject({ ok: false });
  });
});
