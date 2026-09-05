const MENU_ASK = "ai-study-sidekick-selection";

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.warn("Could not configure side panel:", error));

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ASK,
      title: "Ask AI about selected text",
      contexts: ["selection"]
    });
  });
}

chrome.runtime.onInstalled.addListener(setupContextMenus);
// Rebuild on service-worker startup too, so an older "Save word to AI"
// context-menu item is removed immediately after reloading the extension.
setupContextMenus();

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
    case "summarize-text":
    // Keep accepting the previous command id for users upgrading an older
    // extension version.
    case "summarize-page": {
      await chrome.storage.local.set({
        pendingAction: {
          action: "summarize",
          text: selectionText,
          title: tab.title || "",
          url: tab.url || "",
          updatedAt: Date.now()
        }
      });
      await openSidePanel(tab);
      break;
    }
  }
});
