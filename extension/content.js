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
  // Use the complete visible text from the page body. Keep the size cap to
  // avoid sending an unbounded DOM to the model.
  const body = document.body;
  if (!body) return "";
  return normalizeText(body.innerText || "").slice(0, MAX_PAGE_CHARS);
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
      // Page may be closing or extension just reloaded.
    }
  }, 180);
}

document.addEventListener("mouseup", captureSelection, true);
document.addEventListener("keyup", captureSelection, true);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_PAGE_CONTEXT") {
    sendResponse({ ok: true, context: currentContext() });
  }
  return true;
});
