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

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const text = (info.selectionText || "").trim();
  if (!text) return;

  if (info.menuItemId === MENU_SAVE_WORD) {
    await chrome.storage.local.set({
      pendingSaveWord: {
        text,
        title: tab?.title || "",
        url: tab?.url || "",
        updatedAt: Date.now()
      }
    });
    if (tab?.windowId) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } catch (error) {
        console.warn("Could not open side panel:", error);
      }
    }
  }

  if (info.menuItemId === MENU_ASK) {
    await chrome.storage.local.set({
      pendingSelection: {
        text,
        title: tab?.title || "",
        url: tab?.url || "",
        updatedAt: Date.now()
      }
    });
    if (tab?.windowId) {
      try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
      } catch (error) {
        console.warn("Could not open side panel:", error);
      }
    }
  }
});
