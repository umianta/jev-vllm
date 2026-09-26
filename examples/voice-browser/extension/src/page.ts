// Functions injected into the controlled tab with chrome.scripting.executeScript.
// Each is serialized on its own, so it must be self-contained: no imports, and
// every helper nested inside.
import type { Action, PageState } from "../../src/types";

/** Label up to 26 visible interactive elements a–z and return them. */
export function snapshotPage(): PageState {
  const MAX = 26;
  const IDS = "abcdefghijklmnopqrstuvwxyz";
  const SELECTOR = [
    "a[href]", "button", "input:not([type=hidden])", "textarea", "select", "summary",
    "[role=button]", "[role=link]", "[role=tab]", "[role=menuitem]", "[role=option]",
    "[role=checkbox]", "[role=switch]", "[contenteditable=''],[contenteditable=true]",
  ].join(",");

  const vw = innerWidth, vh = innerHeight;
  const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

  const labelOf = (el: HTMLElement): string => {
    const aria = el.getAttribute("aria-label");
    if (aria) return squash(aria);
    const by = el.getAttribute("aria-labelledby");
    if (by) {
      const t = squash(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" "));
      if (t) return t;
    }
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const lab = el.labels?.[0]?.textContent;
      return squash(lab || el.placeholder || el.getAttribute("name") || el.title || (el.type === "submit" ? el.value : ""));
    }
    if (el instanceof HTMLSelectElement) {
      return squash(el.labels?.[0]?.textContent || el.getAttribute("name")) + ` ${squash(el.selectedOptions[0]?.text)}`;
    }
    const text = squash(el.innerText);
    if (text) return text;
    return squash(el.title || el.querySelector("img")?.alt || el.querySelector("svg title")?.textContent);
  };

  const roleOf = (el: HTMLElement): string => {
    const role = el.getAttribute("role");
    if (role) return role === "menuitem" ? "item" : role;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "input") {
      const t = (el as HTMLInputElement).type;
      if (t === "checkbox" || t === "radio") return "checkbox";
      if (t === "submit" || t === "button") return "button";
      return "input";
    }
    if (tag === "summary") return "button";
    if (el.isContentEditable) return "textarea";
    return tag;
  };

  const found: { el: HTMLElement; role: string; text: string; top: number; left: number; area: number }[] = [];
  const seen = new Set<string>();
  for (const el of document.querySelectorAll<HTMLElement>(SELECTOR)) {
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > vh || r.right < 0 || r.left > vw) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
    if ((el as HTMLButtonElement).disabled) continue;
    const text = labelOf(el).slice(0, 60);
    if (!text) continue;
    const role = roleOf(el);
    const key = `${role}|${text}`;
    if (seen.has(key)) continue; // e.g. thumbnail and title linking to the same video
    seen.add(key);
    found.push({ el, role, text, top: r.top, left: r.left, area: r.width * r.height });
  }

  // Too many: keep form fields plus the largest elements, then restore reading order.
  let keep = found;
  if (found.length > MAX) {
    const fields = found.filter((f) => f.role === "input" || f.role === "textarea");
    const rest = found.filter((f) => !fields.includes(f)).sort((a, b) => b.area - a.area);
    keep = [...fields.slice(0, 6), ...rest].slice(0, MAX);
  }
  keep.sort((a, b) => a.top - b.top || a.left - b.left);

  document.querySelectorAll("[data-jev-id]").forEach((e) => e.removeAttribute("data-jev-id"));
  const elements = keep.map((f, i) => {
    f.el.setAttribute("data-jev-id", IDS[i]);
    return { id: IDS[i], role: f.role, text: f.text };
  });
  return { url: location.href, title: document.title, elements };
}

/** Run a page-level action (click, type, scroll, highlight) and show feedback on the page. */
export function runPageAction(action: Action): { ok: boolean; error?: string } {
  const HOST_ID = "__jev_overlay__";

  const overlay = () => {
    let host = document.getElementById(HOST_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = HOST_ID;
      host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
      document.documentElement.appendChild(host);
    }
    return host;
  };

  const box = (el: Element, badge: string | null, color: string, ms: number) => {
    const r = el.getBoundingClientRect();
    const b = document.createElement("div");
    b.style.cssText = `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;` +
      `border:3px solid ${color};border-radius:6px;box-shadow:0 0 0 4px ${color}33;transition:opacity .3s`;
    if (badge) {
      const t = document.createElement("span");
      t.textContent = badge;
      t.style.cssText = `position:absolute;left:-3px;top:-24px;background:${color};color:#fff;font:700 13px/20px system-ui;padding:0 7px;border-radius:5px`;
      b.appendChild(t);
    }
    overlay().appendChild(b);
    setTimeout(() => { b.style.opacity = "0"; setTimeout(() => b.remove(), 300); }, ms);
  };

  const toast = (text: string) => {
    const t = document.createElement("div");
    t.textContent = `🎙 ${text}`;
    t.style.cssText = "position:fixed;right:16px;bottom:16px;background:#8250df;color:#fff;font:600 14px system-ui;" +
      "padding:8px 12px;border-radius:8px;box-shadow:0 4px 16px #0004;transition:opacity .3s";
    overlay().appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 1800);
  };

  const byId = (id: string) => document.querySelector<HTMLElement>(`[data-jev-id="${id}"]`);

  try {
    if (action.kind === "highlight") {
      for (const id of action.ids) {
        const el = byId(id);
        if (el) box(el, id, "#9a6700", 5000);
      }
      toast(action.label);
      return { ok: true };
    }
    if (action.kind === "scroll") {
      const sign = action.direction === "down" ? 1 : -1;
      if (action.amount === "end") scrollTo({ top: sign > 0 ? document.documentElement.scrollHeight : 0, behavior: "smooth" });
      else scrollBy({ top: sign * innerHeight * (action.amount === "page" ? 0.85 : 0.35), behavior: "smooth" });
      toast(action.label);
      return { ok: true };
    }
    if (action.kind === "click" || action.kind === "type") {
      const el = byId(action.id);
      if (!el) return { ok: false, error: `element ${action.id} is gone` };
      el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
      box(el, action.id, "#8250df", 1200);
      toast(action.label);
      if (action.kind === "click") {
        el.focus();
        el.click();
        return { ok: true };
      }
      el.focus();
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        // Use the native setter so frameworks like React see the change.
        const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
        Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, action.text);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (el.isContentEditable) {
        document.execCommand("insertText", false, action.text);
      } else {
        return { ok: false, error: "not a text field" };
      }
      if (action.submit) {
        const enter = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
        el.dispatchEvent(new KeyboardEvent("keydown", enter));
        el.dispatchEvent(new KeyboardEvent("keyup", enter));
        const form = (el as HTMLInputElement).form;
        if (form) form.requestSubmit();
      }
      return { ok: true };
    }
    return { ok: false, error: `not a page action: ${action.kind}` };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
