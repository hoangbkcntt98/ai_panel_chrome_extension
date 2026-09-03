const MAX_SELECTION_CHARS = 8000;
const MAX_PAGE_CHARS = 16000;
let selectionTimer;
let lastSelectionText = "";

function normalizeText(text) {
  return (text || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getSelectionText() {
  return normalizeText(window.getSelection()?.toString() || "").slice(0, MAX_SELECTION_CHARS);
}

function getPageText() {
  const main = document.querySelector("main, article, [role='main']");
  const source = main?.innerText || document.body?.innerText || "";
  return normalizeText(source).slice(0, MAX_PAGE_CHARS);
}

function currentContext() {
  return {
    title: document.title || "",
    url: location.href,
    selection: getSelectionText(),
    pageText: getPageText()
  };
}

function captureSelection() {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(async () => {
    const text = getSelectionText();
    if (!text || text === lastSelectionText) return;
    lastSelectionText = text;

    try {
      await chrome.storage.local.set({
        lastSelection: {
          text,
          title: document.title || "",
          url: location.href,
          updatedAt: Date.now()
        }
      });
    } catch {
      // Trang có thể đang đóng hoặc extension vừa reload.
    }
  }, 180);
}

document.addEventListener("mouseup", captureSelection, true);
document.addEventListener("keyup", captureSelection, true);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_CONTEXT") {
    sendResponse({ ok: true, context: currentContext() });
  }
});
