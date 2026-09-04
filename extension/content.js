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
  // Try multiple selectors in priority order for best content extraction
  const selectors = [
    "main",
    "article",
    "[role='main']",
    "#content",
    "#main-content",
    ".main-content",
    ".content",
    "#main",
    ".post-content",
    ".entry-content",
    ".article-content",
    ".markdown-body"
  ];

  let source = "";
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.innerText && el.innerText.trim().length > 200) {
      source = el.innerText;
      break;
    }
  }

  // Fallback to body, but try to strip nav/footer/sidebar noise
  if (!source) {
    const body = document.body;
    if (!body) return "";

    // Clone body and remove noisy elements
    const clone = body.cloneNode(true);
    const noiseSelectors = [
      "nav", "header", "footer", "aside",
      "[role='navigation']", "[role='banner']", "[role='contentinfo']",
      "[role='complementary']",
      ".sidebar", ".menu", ".navbar", ".footer", ".header",
      ".ad", ".ads", ".advertisement",
      ".cookie-banner", ".cookie-notice",
      ".popup", ".modal", ".overlay",
      "script", "style", "noscript", "iframe"
    ];
    for (const sel of noiseSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }
    source = clone.innerText || body.innerText || "";
  }

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
