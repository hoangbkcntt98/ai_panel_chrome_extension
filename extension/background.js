const MENU_ASK = "ai-study-sidekick-selection";
const MENU_SAVE_WORD = "ai-study-sidekick-save-word";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("Could not configure side panel:", error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_SAVE_WORD,
      title: "Save word to AI",
      contexts: ["selection"]
    });
    chrome.contextMenus.create({
      id: MENU_ASK,
      title: "Ask AI about selected text",
      contexts: ["selection"]
    });
  });
});

async function openSidePanel(tab) {
  if (tab?.windowId) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.warn("Could not open side panel:", error);
    }
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function getSelectionFromTab(tabId) {
  try {
    const [{ result: selectionText }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.getSelection()?.toString()?.trim() || ""
    });
    return selectionText;
  } catch {
    return "";
  }
}

// ===== Context menu handler =====
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || "").trim();
  if (!text) return;

  if (info.menuItemId === MENU_SAVE_WORD) {
    await chrome.storage.local.set({
      pendingSaveWord: { text, title: tab?.title || "", url: tab?.url || "", updatedAt: Date.now() }
    });
    await openSidePanel(tab);
  }

  if (info.menuItemId === MENU_ASK) {
    await chrome.storage.local.set({
      pendingSelection: { text, title: tab?.title || "", url: tab?.url || "", updatedAt: Date.now() }
    });
    await openSidePanel(tab);
  }
});

// ===== Keyboard shortcuts (commands) =====
chrome.commands.onCommand.addListener(async (command) => {
  const tab = await getActiveTab();
  if (!tab?.id) return;

  // Get selected text from the page
  const selectionText = await getSelectionFromTab(tab.id);

  switch (command) {
    case "save-word": {
      if (selectionText) {
        await chrome.storage.local.set({
          pendingSaveWord: { text: selectionText, title: tab.title || "", url: tab.url || "", updatedAt: Date.now() }
        });
        await openSidePanel(tab);
      }
      break;
    }
    case "ask-ai": {
      if (selectionText) {
        await chrome.storage.local.set({
          pendingSelection: { text: selectionText, title: tab.title || "", url: tab.url || "", updatedAt: Date.now() }
        });
        await openSidePanel(tab);
      }
      break;
    }
    case "summarize-page": {
      await chrome.storage.local.set({
        pendingAction: { action: "summarize", updatedAt: Date.now() }
      });
      await openSidePanel(tab);
      break;
    }
  }
});
