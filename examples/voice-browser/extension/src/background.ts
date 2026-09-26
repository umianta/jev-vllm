// Toolbar button → open (or focus) the voice-control window.
const KEY = "panelWindowId";

chrome.action.onClicked.addListener(async () => {
  const { [KEY]: id } = await chrome.storage.session.get(KEY);
  if (typeof id === "number") {
    try {
      await chrome.windows.update(id, { focused: true });
      return;
    } catch {
      // window was closed
    }
  }
  const win = await chrome.windows.create({ url: "panel.html", type: "popup", width: 420, height: 660 });
  await chrome.storage.session.set({ [KEY]: win.id });
});
