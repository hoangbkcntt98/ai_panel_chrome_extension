const MENU_ID = "ai-study-sidekick-selection";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("Could not configure side panel:", error));

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Ask AI about selected text",
      contexts: ["selection"]
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const text = (info.selectionText || "").trim();
  if (text) {
    await chrome.storage.local.set({
      pendingSelection: {
        text,
        title: tab?.title || "",
        url: tab?.url || "",
        updatedAt: Date.now()
      }
    });
  }

  if (tab?.windowId) {
    try {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
      console.warn("Could not open side panel:", error);
    }
  }
});
