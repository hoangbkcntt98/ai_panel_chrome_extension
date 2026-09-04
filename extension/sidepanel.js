const DEFAULT_BACKEND_URL = "http://localhost:8787";
const STORAGE_KEYS = {
  messages: "chatMessages",
  settings: "assistantSettings",
  lastSelection: "lastSelection",
  pendingSelection: "pendingSelection",
  activeSection: "activeSection",
  sectionContexts: "sectionContexts",
  pendingSaveWord: "pendingSaveWord",
  pendingAction: "pendingAction",
  contextTab: "contextTab"
};

const DEFAULT_SHORTCUTS = {
  explain: "Alt+E",
  translate: "Alt+T",
  summarize: "Alt+S",
  saveWord: "Alt+W",
  readAloud: "Alt+R",
  stopTts: "Esc"
};

const SHORTCUT_ACTIONS = ["explain", "translate", "summarize", "saveWord", "readAloud", "stopTts"];
const SHORTCUT_INPUT_IDS = {
  explain: "shortcutExplain",
  translate: "shortcutTranslate",
  summarize: "shortcutSummarize",
  saveWord: "shortcutSaveWord",
  readAloud: "shortcutReadAloud",
  stopTts: "shortcutStopTts"
};

function normalizeShortcut(combo) {
  return String(combo || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^Command\+/i, "Cmd+")
    .replace(/^Control\+/i, "Ctrl+")
    .replace(/Escape$/i, "Esc");
}

function shortcutInput(action) {
  return document.getElementById(SHORTCUT_INPUT_IDS[action]);
}

function normalizeKeyLabel(key) {
  if (key === "Escape") return "Esc";
  if (key === " ") return "Space";
  if (key === "+") return "Plus";
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function formatCombo(event) {
  const parts = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.metaKey) parts.push("Cmd");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = event.key;
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return "";
  if (!key || key === "Unidentified" || key === "Dead") return "";
  const label = normalizeKeyLabel(key);
  parts.push(label);
  return normalizeShortcut(parts.join("+"));
}

function comboMatchesEvent(combo, event) {
  combo = normalizeShortcut(combo);
  if (!combo) return false;
  const parts = combo.split("+").map((p) => p.trim());
  const keyPart = parts.pop();
  const keyLabel = normalizeKeyLabel(event.key);
  if (keyLabel.toLowerCase() !== String(keyPart).toLowerCase()) return false;
  const lowerParts = parts.map((part) => part.toLowerCase());
  const wantCtrl = lowerParts.includes("ctrl");
  const wantCmd = lowerParts.includes("cmd");
  const wantAlt = lowerParts.includes("alt");
  const wantShift = lowerParts.includes("shift");
  const wantMeta = wantCtrl || wantCmd;
  if (wantMeta !== (event.ctrlKey || event.metaKey)) return false;
  if (wantAlt !== event.altKey) return false;
  if (wantShift !== event.shiftKey) return false;
  return true;
}

const state = {
  messages: [],
  selection: "",
  selectionUrl: "",
  context: null,
  contextTab: null,
  loading: false,
  settings: {
    backendUrl: DEFAULT_BACKEND_URL,
    model: "",
    systemPrompt: "",
    outputLanguage: "",
    shortcuts: { ...DEFAULT_SHORTCUTS }
  },
  backendInfo: null,
  activeSection: null,   // { sectionKey, title, persistHistory }
  sectionContext: null,
  sectionContexts: {},
  sections: []
};

let shortcutDraft = { ...DEFAULT_SHORTCUTS };
let shortcutCaptureInput = null;

const el = {
  chat: document.querySelector("#chat"),
  messageTemplate: document.querySelector("#messageTemplate"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  includeContext: document.querySelector("#includeContext"),
  statusText: document.querySelector("#statusText"),
  pageLabel: document.querySelector("#pageLabel"),
  addTabContextButton: document.querySelector("#addTabContextButton"),
  contextTabCard: document.querySelector("#contextTabCard"),
  contextTabLabel: document.querySelector("#contextTabLabel"),
  removeContextTabButton: document.querySelector("#removeContextTabButton"),
  tabContextDialog: document.querySelector("#tabContextDialog"),
  tabContextList: document.querySelector("#tabContextList"),
  closeTabContextButton: document.querySelector("#closeTabContextButton"),
  selectionCard: document.querySelector("#selectionCard"),
  selectionText: document.querySelector("#selectionText"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
  readSelectionButton: document.querySelector("#readSelectionButton"),
  clearChatButton: document.querySelector("#clearChatButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  backendUrl: document.querySelector("#backendUrl"),
  modelId: document.querySelector("#modelId"),
  modelOptions: document.querySelector("#modelOptions"),
  refreshModelsButton: document.querySelector("#refreshModelsButton"),
  providerInfo: document.querySelector("#providerInfo"),
  systemPrompt: document.querySelector("#systemPrompt"),
  outputLanguage: document.querySelector("#outputLanguage"),
  testBackendButton: document.querySelector("#testBackendButton"),
  saveSettingsButton: document.querySelector("#saveSettingsButton"),
  settingsStatus: document.querySelector("#settingsStatus"),
  resetShortcutsButton: document.querySelector("#resetShortcutsButton"),
  stopTtsButton: document.querySelector("#stopTtsButton"),
  resetHistoryButton: document.querySelector("#resetHistoryButton"),
  // Section management
  sectionSelect: document.querySelector("#sectionSelect"),
  newSectionButton: document.querySelector("#newSectionButton"),
  deleteSectionButton: document.querySelector("#deleteSectionButton"),
  newSectionDialog: document.querySelector("#newSectionDialog"),
  newSectionTitle: document.querySelector("#newSectionTitle"),
  newSectionPersist: document.querySelector("#newSectionPersist"),
  cancelNewSectionButton: document.querySelector("#cancelNewSectionButton"),
  createSectionButton: document.querySelector("#createSectionButton"),
  newSectionStatus: document.querySelector("#newSectionStatus"),
  // Words management
  saveWordButton: document.querySelector("#saveWordButton"),
  wordsButton: document.querySelector("#wordsButton"),
  wordsDialog: document.querySelector("#wordsDialog"),
  closeWordsButton: document.querySelector("#closeWordsButton"),
  wordsList: document.querySelector("#wordsList"),
  wordsCount: document.querySelector("#wordsCount"),
  // Shortcut inputs
  shortcutExplain: document.querySelector("#shortcutExplain"),
  shortcutTranslate: document.querySelector("#shortcutTranslate"),
  shortcutSummarize: document.querySelector("#shortcutSummarize"),
  shortcutSaveWord: document.querySelector("#shortcutSaveWord"),
  shortcutReadAloud: document.querySelector("#shortcutReadAloud"),
  shortcutStopTts: document.querySelector("#shortcutStopTts")
};

function renderShortcutInputs(shortcuts = DEFAULT_SHORTCUTS) {
  if (shortcutCaptureInput) {
    shortcutCaptureInput.classList.remove("capturing");
    shortcutCaptureInput = null;
  }
  for (const action of SHORTCUT_ACTIONS) {
    const input = shortcutInput(action);
    if (!input) continue;
    input.value = normalizeShortcut(shortcuts[action] || "");
    input.classList.remove("capturing");
    input.removeAttribute("aria-label");
  }
}

function beginShortcutCapture(input) {
  if (shortcutCaptureInput && shortcutCaptureInput !== input) {
    const previousAction = SHORTCUT_ACTIONS.find((action) => shortcutInput(action) === shortcutCaptureInput);
    if (previousAction) {
      shortcutCaptureInput.value = normalizeShortcut(shortcutDraft[previousAction] || "");
    }
    shortcutCaptureInput.classList.remove("capturing");
  }
  shortcutCaptureInput = input;
  input.classList.add("capturing");
  input.value = "Press keys…";
  input.setAttribute("aria-label", "Press the keyboard combination");
}

function endShortcutCapture() {
  if (shortcutCaptureInput) {
    shortcutCaptureInput.classList.remove("capturing");
  }
  shortcutCaptureInput = null;
}

function readShortcutDraft() {
  const draft = {};
  for (const action of SHORTCUT_ACTIONS) {
    const input = shortcutInput(action);
    if (shortcutCaptureInput === input) {
      // The user focused this field but has not completed a new combo yet.
      draft[action] = normalizeShortcut(shortcutDraft[action] || "");
    } else {
      draft[action] = normalizeShortcut(input?.value || "");
    }
  }
  return draft;
}

function validateShortcutDraft(draft) {
  const seen = new Map();
  for (const action of SHORTCUT_ACTIONS) {
    const combo = normalizeShortcut(draft[action]);
    if (!combo) continue;
    const key = combo.toLowerCase();
    if (seen.has(key)) {
      const previous = seen.get(key);
      return `Shortcut "${combo}" is assigned to both ${previous} and ${action}.`;
    }
    seen.set(key, action);
  }
  return "";
}

function normalizeBackendUrl(url) {
  return (url || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
}

function getApiBase() {
  return state.settings.backendUrl;
}

function normalizeSectionContext(context) {
  if (!context || typeof context !== "object") return null;
  return {
    title: String(context.title || "").slice(0, 500),
    url: String(context.url || "").slice(0, 1500),
    selection: String(context.selection || "").slice(0, 8000),
    pageText: String(context.pageText || "").slice(0, 16000)
  };
}

async function persistSectionContext() {
  const section = state.activeSection;
  const context = normalizeSectionContext(state.context);
  if (!section || !context) return;

  state.sectionContexts[section.sectionKey] = context;
  state.sectionContext = context;
  await chrome.storage.local.set({ [STORAGE_KEYS.sectionContexts]: state.sectionContexts });

  try {
    await fetch(`${getApiBase()}/api/sections/${encodeURIComponent(section.sectionKey)}/context`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ context })
    });
  } catch (error) {
    console.warn("Cannot persist section context:", error.message);
  }
}

// ===== Text-to-Speech =====
const tts = {
  speaking: false,
  currentButton: null,
  synth: window.speechSynthesis,
  defaultLang: "en-US",
  voices: []
};

function loadVoices() {
  tts.voices = tts.synth.getVoices() || [];
  if (!tts.voices.length) return;
  // Pick best English voice
  const enVoice = tts.voices.find((v) => v.lang.startsWith("en") && v.name.includes("Google")) 
    || tts.voices.find((v) => v.lang.startsWith("en-US"))
    || tts.voices.find((v) => v.lang.startsWith("en"));
  if (enVoice) tts.defaultLang = enVoice.lang;
}

if (tts.synth) {
  loadVoices();
  tts.synth.onvoiceschanged = loadVoices;
}

function ttsStop() {
  if (tts.synth) tts.synth.cancel();
  tts.speaking = false;
  if (tts.currentButton) {
    tts.currentButton.classList.remove("speaking");
    tts.currentButton = null;
  }
  el.stopTtsButton.classList.add("hidden");
}

function ttsSpeak(text, button) {
  if (!tts.synth) return;
  ttsStop();

  // Clean markdown for speech
  const cleanText = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[\-\*] /gm, "")
    .replace(/\n+/g, ". ")
    .trim();

  const utter = new SpeechSynthesisUtterance(cleanText);
  
  // Determine language: use output language setting, fallback to English
  const langSetting = state.settings.outputLanguage || "";
  let lang = "en-US";
  if (langSetting.includes("English") || !langSetting) lang = "en-US";
  else if (langSetting.includes("Vi")) lang = "vi-VN";
  else if (langSetting.includes("日本")) lang = "ja-JP";
  else if (langSetting.includes("中文")) lang = "zh-CN";
  else if (langSetting.includes("한국")) lang = "ko-KR";
  else if (langSetting.includes("Fran")) lang = "fr-FR";
  else if (langSetting.includes("Deutsch")) lang = "de-DE";
  else if (langSetting.includes("Espa")) lang = "es-ES";
  else if (langSetting.includes("Рус")) lang = "ru-RU";

  utter.lang = lang;
  utter.rate = 1.0;
  utter.pitch = 1.0;
  
  // Find matching voice
  const matchVoice = tts.voices.find((v) => v.lang === lang)
    || tts.voices.find((v) => v.lang.startsWith(lang.split("-")[0]));
  if (matchVoice) utter.voice = matchVoice;

  utter.onstart = () => {
    tts.speaking = true;
    tts.currentButton = button;
    button.classList.add("speaking");
    el.stopTtsButton.classList.remove("hidden");
  };
  utter.onend = () => {
    tts.speaking = false;
    button.classList.remove("speaking");
    tts.currentButton = null;
    el.stopTtsButton.classList.add("hidden");
  };
  utter.onerror = () => {
    tts.speaking = false;
    button.classList.remove("speaking");
    tts.currentButton = null;
    el.stopTtsButton.classList.add("hidden");
  };

  tts.synth.speak(utter);
}

// ===== Section key generator =====
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 100);
}

// ===== Markdown parser =====
function parseMarkdown(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/_(.+?)_/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^[\-\*] (.+)$/gm, "<li>$1</li>")
    .replace(/  \n/g, "<br>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  html = html.replace(/(<li>.*?<\/li>\s*)+/g, "<ul>$&</ul>");
  return "<p>" + html + "</p>";
}

function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.statusText.classList.toggle("error", isError);
}

function showEmptyState() {
  el.chat.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  if (state.activeSection) {
    wrapper.innerHTML = `
      <div class="sparkle">✦</div>
      <h2>${state.activeSection.title}</h2>
      <p>Ask a question or highlight text on the page, then click "Explain".</p>
    `;
  } else {
    wrapper.innerHTML = `
      <div class="sparkle">✦</div>
      <h2>Select a section</h2>
      <p>Create a new section (＋) or pick from the list to start. Highlight text and ask the AI.</p>
    `;
  }
  el.chat.appendChild(wrapper);
}

function renderMessages() {
  if (!state.messages.length) {
    showEmptyState();
    return;
  }
  el.chat.replaceChildren();
  for (const message of state.messages) {
    const node = el.messageTemplate.content.firstElementChild.cloneNode(true);
    node.classList.add(message.role);
    node.querySelector(".message-role").textContent = message.role === "user" ? "You" : "AI";
    node.querySelector(".message-body").innerHTML = parseMarkdown(message.content);
    const ttsBtn = node.querySelector(".tts-button");
    if (ttsBtn) {
      if (message.role === "assistant") {
        ttsBtn.addEventListener("click", () => ttsSpeak(message.content, ttsBtn));
      } else {
        ttsBtn.style.display = "none";
      }
    }
    el.chat.appendChild(node);
  }
  if (state.loading) {
    const loading = el.messageTemplate.content.firstElementChild.cloneNode(true);
    loading.classList.add("assistant", "loading");
    loading.querySelector(".message-role").textContent = "AI";
    loading.querySelector(".message-body").textContent = "Thinking";
    el.chat.appendChild(loading);
  }
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }));
}

function renderSelection() {
  if (!state.selection) {
    el.selectionCard.classList.add("hidden");
    el.selectionText.textContent = "";
    return;
  }
  el.selectionCard.classList.remove("hidden");
  el.selectionText.textContent = state.selection;
}

// ===== Section management =====
async function fetchSections() {
  try {
    const res = await fetch(`${getApiBase()}/api/sections`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.sections = Array.isArray(data.sections) ? data.sections : [];
    renderSectionSelect();
  } catch (err) {
    console.warn("Cannot fetch sections:", err.message);
  }
}

function renderSectionSelect() {
  const prevValue = el.sectionSelect.value;
  el.sectionSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "— Select a section —";
  el.sectionSelect.appendChild(placeholder);

  for (const sec of state.sections) {
    const opt = document.createElement("option");
    opt.value = sec.section_key;
    const persistTag = sec.persist_history ? " 💾" : "";
    const count = sec.message_count ? ` (${sec.message_count})` : "";
    opt.textContent = sec.title + persistTag + count;
    el.sectionSelect.appendChild(opt);
  }

  el.sectionSelect.value = state.activeSection?.sectionKey || prevValue || "";
  el.deleteSectionButton.classList.toggle("hidden", !state.activeSection);
  el.deleteSectionButton.disabled = !state.activeSection;
}

async function selectSection(sectionKey) {
  // Save current section's messages before switching
  await persistCurrentSection();
  await persistSectionContext();

  if (!sectionKey) {
    state.activeSection = null;
    state.sectionContext = null;
    state.messages = [];
    el.resetHistoryButton.classList.add("hidden");
    el.deleteSectionButton.classList.add("hidden");
    el.deleteSectionButton.disabled = true;
    await chrome.storage.local.set({
      [STORAGE_KEYS.messages]: [],
      [STORAGE_KEYS.activeSection]: null
    });
    renderMessages();
    setStatus("");
    return;
  }

  const sec = state.sections.find((s) => s.section_key === sectionKey);
  if (!sec) return;

  state.activeSection = {
    sectionKey: sec.section_key,
    title: sec.title,
    persistHistory: sec.persist_history,
    context: normalizeSectionContext(sec.context)
  };
  const rememberedContext = state.activeSection.context
    || state.sectionContexts[sectionKey]
    || normalizeSectionContext(state.context);
  state.sectionContext = rememberedContext;
  state.context = rememberedContext;
  state.selection = rememberedContext?.selection || "";
  state.selectionUrl = rememberedContext?.url || "";
  renderSelection();
  el.deleteSectionButton.classList.remove("hidden");
  el.deleteSectionButton.disabled = false;
  await chrome.storage.local.set({ [STORAGE_KEYS.activeSection]: state.activeSection });
  void persistSectionContext();

  // Load messages from DB if persist is on
  if (sec.persist_history) {
    setStatus("Loading chat history…");
    try {
      const res = await fetch(`${getApiBase()}/api/sections/${encodeURIComponent(sectionKey)}/messages`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      state.messages = Array.isArray(data.messages) ? data.messages : [];
      await chrome.storage.local.set({ [STORAGE_KEYS.messages]: state.messages });
    } catch (err) {
      setStatus(`Failed to load history: ${err.message}`, true);
      state.messages = [];
    }
    renderMessages();
    const count = state.messages.length;
    el.resetHistoryButton.classList.remove("hidden");
    setStatus(count ? `Loaded ${count} messages` : "No chat history for this section");
  } else {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.messages);
    state.messages = Array.isArray(stored[STORAGE_KEYS.messages]) ? stored[STORAGE_KEYS.messages] : [];
    el.resetHistoryButton.classList.remove("hidden");
    renderMessages();
    setStatus("");
  }
}

async function persistCurrentSection() {
  if (!state.activeSection || !state.activeSection.persistHistory) return;
  if (!state.messages.length) return;
  try {
    await fetch(`${getApiBase()}/api/sections/${encodeURIComponent(state.activeSection.sectionKey)}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: state.messages })
    });
  } catch (err) {
    console.warn("Persist failed:", err.message);
  }
}

async function createNewSection() {
  const title = el.newSectionTitle.value.trim();
  const persistHistory = el.newSectionPersist.checked;
  if (!title) {
    el.newSectionStatus.textContent = "Please enter a section name";
    el.newSectionStatus.classList.add("error");
    return;
  }

  const sectionKey = slugify(title) || `section-${Date.now()}`;
  el.createSectionButton.disabled = true;
  el.newSectionStatus.textContent = "Creating…";
  el.newSectionStatus.classList.remove("error");

  try {
    const res = await fetch(`${getApiBase()}/api/sections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sectionKey, title, persistHistory })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);

    el.newSectionStatus.textContent = "";
    el.newSectionDialog.close();
    el.newSectionTitle.value = "";
    el.newSectionPersist.checked = false;

    await fetchSections();
    await selectSection(sectionKey);
    el.sectionSelect.value = sectionKey;
  } catch (err) {
    el.newSectionStatus.textContent = `Error: ${err.message}`;
    el.newSectionStatus.classList.add("error");
  } finally {
    el.createSectionButton.disabled = false;
  }
}

async function deleteCurrentSection() {
  if (!state.activeSection) return;
  const sectionKey = state.activeSection.sectionKey;
  const title = state.activeSection.title;
  if (!window.confirm(`Delete section "${title}"? This will also delete its saved chat history.`)) return;
  try {
    el.deleteSectionButton.disabled = true;
    const res = await fetch(`${getApiBase()}/api/sections/${encodeURIComponent(sectionKey)}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    state.activeSection = null;
    delete state.sectionContexts[sectionKey];
    state.sectionContext = null;
    state.messages = [];
    await chrome.storage.local.set({
      [STORAGE_KEYS.messages]: [],
      [STORAGE_KEYS.activeSection]: null,
      [STORAGE_KEYS.sectionContexts]: state.sectionContexts
    });
    await fetchSections();
    renderMessages();
    setStatus(`Section "${title}" deleted`);
  } catch (err) {
    setStatus(`Delete error: ${err.message}`, true);
  } finally {
    el.deleteSectionButton.disabled = !state.activeSection;
  }
}

// ===== Word management =====
async function translateWordWithAI(word) {
  const value = String(word || "").trim().slice(0, 500);
  if (!value) return "";

  const response = await fetch(`${getApiBase()}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{
        role: "user",
        content: `Translate the following word or short phrase into natural Vietnamese. Return only the Vietnamese translation, without explanations or quotation marks. If there are several common meanings, separate them with ";".\n\n${value}`
      }],
      context: null,
      model: state.settings.model || undefined,
      systemPrompt: "You are a concise vocabulary translation assistant. Translate the user's word or phrase into Vietnamese and return only the translation.",
      outputLanguage: "Tiếng Việt"
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Translation HTTP ${response.status}`);
  return String(data.text || "").trim().slice(0, 2000);
}

async function saveWordRecord(text, sourceUrl = "", sourceTitle = "") {
  const value = String(text || "").trim().slice(0, 500);
  if (!value) throw new Error("Missing word");

  let translation = "";
  try {
    setStatus("Translating word…");
    translation = await translateWordWithAI(value);
  } catch (error) {
    // Keep saving even when the AI provider is temporarily unavailable.
    console.warn("Cannot translate word:", error.message);
  }

  const res = await fetch(`${getApiBase()}/api/words`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      word: value,
      translation,
      context: value,
      sourceUrl: sourceUrl || "",
      sourceTitle: sourceTitle || ""
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { saved: data.word || null, translation };
}

async function saveWord() {
  const text = (state.selection || "").trim();
  if (!text) {
    setStatus("Select text first to save as word");
    return;
  }
  const context = state.context || {};
  try {
    const result = await saveWordRecord(text, context.url || "", context.title || "");
    const suffix = result.translation ? ` → ${result.translation}` : " (translation unavailable)";
    setStatus(`Saved word: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"${suffix}`);
  } catch (err) {
    setStatus(`Save word error: ${err.message}`, true);
  }
}

async function loadWords() {
  try {
    const res = await fetch(`${getApiBase()}/api/words`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return Array.isArray(data.words) ? data.words : [];
  } catch (err) {
    console.warn("Cannot load words:", err.message);
    return [];
  }
}

async function deleteWord(id) {
  try {
    await fetch(`${getApiBase()}/api/words/${id}`, { method: "DELETE" });
  } catch (err) {
    console.warn("Cannot delete word:", err.message);
  }
}

async function openWordsDialog() {
  el.wordsList.innerHTML = '<p class="words-empty">Loading…</p>';
  el.wordsCount.textContent = "";
  el.wordsDialog.showModal();

  const words = await loadWords();
  if (!words.length) {
    el.wordsList.innerHTML = '<p class="words-empty">No saved words yet. Right-click selected text on any page → "Save word to AI"</p>';
    return;
  }

  el.wordsCount.textContent = `${words.length} word${words.length > 1 ? "s" : ""} saved`;
  el.wordsList.replaceChildren();

  for (const w of words) {
    const item = document.createElement("div");
    item.className = "word-item";

    const header = document.createElement("div");
    header.className = "word-item-header";

    const wordEl = document.createElement("div");
    wordEl.className = "word-item-word";
    wordEl.textContent = w.word;

    const delBtn = document.createElement("button");
    delBtn.className = "word-item-delete";
    delBtn.textContent = "🗑";
    delBtn.title = "Delete";
    delBtn.addEventListener("click", async () => {
      await deleteWord(w.id);
      item.remove();
      const remaining = el.wordsList.querySelectorAll(".word-item").length;
      el.wordsCount.textContent = `${remaining} word${remaining !== 1 ? "s" : ""} saved`;
      if (!remaining) {
        el.wordsList.innerHTML = '<p class="words-empty">No saved words yet.</p>';
      }
    });

    header.append(wordEl, delBtn);
    item.append(header);

    if (w.translation) {
      const translation = document.createElement("div");
      translation.className = "word-item-translation";
      translation.textContent = w.translation;
      item.append(translation);
    }

    if (w.source_url || w.source_title) {
      const source = document.createElement("div");
      source.className = "word-item-source";
      if (w.source_url) {
        const a = document.createElement("a");
        a.href = w.source_url;
        a.target = "_blank";
        a.textContent = w.source_title || w.source_url;
        source.append("Source: ", a);
      } else {
        source.textContent = `Source: ${w.source_title}`;
      }
      item.append(source);
    }

    const date = document.createElement("div");
    date.className = "word-item-date";
    date.textContent = new Date(w.created_at).toLocaleString();
    item.append(date);

    el.wordsList.append(item);
  }
}

async function resetSectionHistory() {
  if (!state.activeSection) return;
  const sectionKey = state.activeSection.sectionKey;
  const title = state.activeSection.title;
  try {
    setStatus("Resetting history…");
    // Clear from DB (if persist is on)
    if (state.activeSection.persistHistory) {
      const res = await fetch(`${getApiBase()}/api/sections/${encodeURIComponent(sectionKey)}/messages`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    }
    // Clear from local state
    state.messages = [];
    await chrome.storage.local.set({ [STORAGE_KEYS.messages]: [] });
    // Stop any TTS
    ttsStop();
    renderMessages();
    setStatus(`History reset for "${title}"`);
  } catch (err) {
    setStatus(`Reset error: ${err.message}`, true);
  }
}

// ===== Message persistence =====
async function saveMessages() {
  await chrome.storage.local.set({ [STORAGE_KEYS.messages]: state.messages.slice(-40) });
  if (state.activeSection?.persistHistory) {
    await persistCurrentSection();
  }
}

// ===== State loading =====
async function loadState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  state.messages = Array.isArray(stored[STORAGE_KEYS.messages]) ? stored[STORAGE_KEYS.messages] : [];
  state.sectionContexts = stored[STORAGE_KEYS.sectionContexts] && typeof stored[STORAGE_KEYS.sectionContexts] === "object"
    ? stored[STORAGE_KEYS.sectionContexts]
    : {};
  state.settings = {
    backendUrl: normalizeBackendUrl(stored[STORAGE_KEYS.settings]?.backendUrl || DEFAULT_BACKEND_URL),
    model: String(stored[STORAGE_KEYS.settings]?.model || "").trim(),
    systemPrompt: String(stored[STORAGE_KEYS.settings]?.systemPrompt || "").trim(),
    outputLanguage: String(stored[STORAGE_KEYS.settings]?.outputLanguage || "").trim(),
    shortcuts: Object.fromEntries(
      SHORTCUT_ACTIONS.map((action) => [
        action,
        normalizeShortcut(stored[STORAGE_KEYS.settings]?.shortcuts?.[action] || DEFAULT_SHORTCUTS[action])
      ])
    )
  };
  shortcutDraft = { ...state.settings.shortcuts };

  const selectionCandidate = stored[STORAGE_KEYS.pendingSelection] || stored[STORAGE_KEYS.lastSelection];
  if (selectionCandidate?.text) {
    state.selection = selectionCandidate.text;
    state.selectionUrl = String(selectionCandidate.url || "").trim();
  }
  if (stored[STORAGE_KEYS.pendingSelection]) {
    await chrome.storage.local.remove(STORAGE_KEYS.pendingSelection);
  }
  const savedContextTab = stored[STORAGE_KEYS.contextTab];
  if (savedContextTab?.tabId && savedContextTab.context) {
    state.contextTab = {
      tabId: savedContextTab.tabId,
      title: String(savedContextTab.title || "").slice(0, 500),
      url: String(savedContextTab.url || "").slice(0, 1500),
      context: normalizeSectionContext(savedContextTab.context)
    };
  }

  el.backendUrl.value = state.settings.backendUrl;
  el.modelId.value = state.settings.model;
  el.systemPrompt.value = state.settings.systemPrompt;
  el.outputLanguage.value = state.settings.outputLanguage;
  renderShortcutInputs(state.settings.shortcuts);

  renderMessages();
  renderSelection();
  renderContextTab();
  await refreshPageContext();
  state.activeSection = stored[STORAGE_KEYS.activeSection] || null;
  await refreshContextTab();
}

async function getTabContext(tab) {
  if (!tab?.id) throw new Error("No tab found");
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
    if (response?.ok && response.context) return response.context;
  } catch {
    // Fall back to direct script execution for pages where the content script
    // was not injected (for example, a tab opened before the extension reload).
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => ({
      title: document.title || "",
      url: location.href,
      selection: window.getSelection()?.toString()?.trim() || "",
      pageText: (document.body?.innerText || "").slice(0, 16000)
    })
  });
  if (!result) throw new Error("Could not read current tab");
  return result;
}

async function getCurrentTabContext() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return getTabContext(tab);
}

function renderContextTab() {
  const selected = state.contextTab;
  const hasContext = Boolean(selected?.context);
  el.contextTabCard?.classList.toggle("hidden", !hasContext);
  if (el.contextTabLabel) {
    el.contextTabLabel.textContent = hasContext
      ? `${selected.title || selected.context.title || "Untitled tab"}${selected.url ? ` · ${selected.url}` : ""}`
      : "";
    el.contextTabLabel.title = selected?.url || "";
  }
  if (el.messageInput) {
    el.messageInput.placeholder = hasContext
      ? "Ask about the selected tab…"
      : "Ask about this page…";
  }
}

async function refreshContextTab() {
  if (!state.contextTab?.tabId) return;
  try {
    const tab = await chrome.tabs.get(state.contextTab.tabId);
    const context = await getTabContext(tab);
    state.contextTab = {
      tabId: tab.id,
      title: tab.title || context.title || "",
      url: tab.url || context.url || "",
      context: normalizeSectionContext(context)
    };
    console.info("[AI Sidekick] Context tab loaded", {
      tabId: tab.id,
      title: state.contextTab.title,
      url: state.contextTab.url,
      pageTextChars: state.contextTab.context.pageText.length
    });
    await chrome.storage.local.set({ [STORAGE_KEYS.contextTab]: state.contextTab });
    renderContextTab();
  } catch {
    console.warn("[AI Sidekick] Context tab could not be read", {
      tabId: state.contextTab?.tabId || null
    });
    state.contextTab = null;
    await chrome.storage.local.remove(STORAGE_KEYS.contextTab);
    renderContextTab();
  }
}

async function openTabContextDialog() {
  if (!el.tabContextDialog || !el.tabContextList) return;
  el.tabContextList.replaceChildren();
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    for (const tab of tabs) {
      if (!tab.id) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tab-context-option";
      button.innerHTML = `<strong></strong><span></span>`;
      button.querySelector("strong").textContent = tab.title || "Untitled tab";
      button.querySelector("span").textContent = tab.url || "";
      if (state.contextTab?.tabId === tab.id) button.classList.add("selected");
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          const context = await getTabContext(tab);
          state.contextTab = {
            tabId: tab.id,
            title: tab.title || context.title || "",
            url: tab.url || context.url || "",
            context: normalizeSectionContext(context)
          };
          console.info("[AI Sidekick] Context tab selected", {
            tabId: tab.id,
            title: state.contextTab.title,
            url: state.contextTab.url,
            pageTextChars: state.contextTab.context.pageText.length
          });
          el.includeContext.checked = true;
          await chrome.storage.local.set({ [STORAGE_KEYS.contextTab]: state.contextTab });
          renderContextTab();
          el.tabContextDialog.close();
          setStatus(`Context tab added: ${state.contextTab.title || "Untitled tab"}`);
        } catch (error) {
          setStatus(`Cannot read selected tab: ${error.message}`, true);
        } finally {
          button.disabled = false;
        }
      });
      el.tabContextList.appendChild(button);
    }
    if (!tabs.length) {
      const empty = document.createElement("p");
      empty.className = "field-help";
      empty.textContent = "No browser tabs available.";
      el.tabContextList.appendChild(empty);
    }
    el.tabContextDialog.showModal();
  } catch (error) {
    setStatus(`Cannot list browser tabs: ${error.message}`, true);
  }
}

async function refreshPageContext() {
  try {
    const context = await getCurrentTabContext();
    state.context = normalizeSectionContext(context);
    if (context?.selection) {
      state.selection = context.selection;
      state.selectionUrl = context.url || "";
    }
    el.pageLabel.textContent = context?.title || "Current page";
    renderSelection();
    const samePageAsSection = !state.sectionContext?.url
      || !state.context?.url
      || state.sectionContext.url === state.context.url;
    if (state.activeSection && samePageAsSection) {
      // Keep a snapshot so switching sections restores its own page context.
      void persistSectionContext();
    }
  } catch {
    state.context = null;
    el.pageLabel.textContent = "This page does not allow reading content";
  }
}

function buildContextPayload(force = false, selectionOnly = false) {
  if (!force && !el.includeContext.checked) return null;
  const liveContext = state.context || {};
  const rememberedContext = state.sectionContext;
  const tabContext = state.contextTab?.context;
  const usingSelectedTab = !selectionOnly && Boolean(tabContext);
  const usingRememberedSection = !selectionOnly
    && !usingSelectedTab
    && Boolean(rememberedContext?.url && liveContext.url && rememberedContext.url !== liveContext.url);
  const context = selectionOnly
    ? liveContext
    : tabContext
      || (rememberedContext?.url
        && liveContext.url
        && rememberedContext.url !== liveContext.url
        ? rememberedContext
        : liveContext);
  const selection = context.selection
    || (state.selectionUrl && context.url && state.selectionUrl === context.url ? state.selection : "");
  return {
    title: context.title || "",
    url: context.url || "",
    selection,
    source: selectionOnly
      ? "current-tab-selection"
      : usingSelectedTab
        ? "selected-tab"
        : usingRememberedSection
          ? "section-context"
          : "current-tab",
    contextTabId: usingSelectedTab ? state.contextTab?.tabId || null : null,
    // Summary text intentionally excludes the page body and sends only the
    // selected passage to the model.
    pageText: selectionOnly ? "" : (context.pageText || "")
  };
}

// ===== Chat =====
async function askAssistant(text, forceContext = false, selectionOnly = false) {
  const content = (text || "").trim();
  if (!content || state.loading) return;

  state.loading = true;
  el.sendButton.disabled = true;
  state.messages.push({ role: "user", content });
  await saveMessages();
  renderMessages();
  setStatus("Sending to backend…");

  try {
    await refreshPageContext();
    await refreshContextTab();
    const contextPayload = buildContextPayload(forceContext, selectionOnly);
    console.info("[AI Sidekick] Sending context", {
      source: contextPayload?.source || "none",
      contextTabId: contextPayload?.contextTabId || null,
      title: contextPayload?.title || "",
      url: contextPayload?.url || "",
      selectionChars: contextPayload?.selection?.length || 0,
      pageTextChars: contextPayload?.pageText?.length || 0
    });
    if (selectionOnly && !contextPayload?.selection) {
      state.messages.pop();
      await saveMessages();
      renderMessages();
      setStatus("Please select some text first to summarize.", true);
      return;
    }
    const response = await fetch(`${getApiBase()}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.slice(-12),
        context: contextPayload,
        model: state.settings.model || undefined,
        systemPrompt: state.settings.systemPrompt || undefined,
        outputLanguage: state.settings.outputLanguage || undefined
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Backend returned HTTP ${response.status}`);
    if (!data.text) throw new Error("Backend returned no content");

    state.messages.push({ role: "assistant", content: data.text });
    if (data.model && !state.settings.model) {
      state.settings.model = data.model;
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: state.settings });
    }
    await saveMessages();
    const modelLabel = data.model ? ` · ${data.model}` : "";
    setStatus(`Answered · ${data.provider || "AI"}${modelLabel}`);
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Cannot connect to assistant. ${error.message}\n\nOpen ⚙ and check Backend URL / API key.`
    });
    await saveMessages();
    setStatus("Error calling backend", true);
  } finally {
    state.loading = false;
    el.sendButton.disabled = false;
    renderMessages();
  }
}

function quickPrompt(action) {
  const selected = state.selection?.trim();
  if (action === "explain") {
    return selected
      ? `Explain the following passage in an easy-to-understand way, highlighting key points and examples if useful:\n\n${selected}`
      : "Explain the main content of this page in an easy-to-understand way, focusing on key concepts.";
  }
  if (action === "translate") {
    return selected
      ? `Translate the following passage into Vietnamese naturally, preserving the meaning and briefly explaining difficult terms if any:\n\n${selected}`
      : "Translate and briefly explain the most important content of this page into Vietnamese.";
  }
  if (action === "summarize") {
    return "Summarize the selected text below. Provide the main points, key takeaways, and concise bullet-point notes if useful. Base your response ONLY on the selected text, not on the rest of the page or prior knowledge.";
  }
  return "";
}

// ===== Model management =====
function renderModelOptions(models = []) {
  el.modelOptions.replaceChildren();
  for (const model of models) {
    const option = document.createElement("option");
    option.value = model;
    el.modelOptions.appendChild(option);
  }
}

async function refreshModels() {
  const url = normalizeBackendUrl(el.backendUrl.value);
  el.refreshModelsButton.disabled = true;
  el.settingsStatus.textContent = "Loading model list…";
  el.settingsStatus.classList.remove("error");
  try {
    const response = await fetch(`${url}/models`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const models = Array.isArray(data.models) ? data.models : [];
    renderModelOptions(models);
    if (!el.modelId.value && data.defaultModel) el.modelId.value = data.defaultModel;
    el.settingsStatus.textContent = models.length
      ? `Loaded ${models.length} models from ${data.provider || "backend"}`
      : "Backend returned no models; you can still enter a Model ID manually.";
  } catch (error) {
    el.settingsStatus.textContent = `Failed to load models: ${error.message}`;
    el.settingsStatus.classList.add("error");
  } finally {
    el.refreshModelsButton.disabled = false;
  }
}

async function testBackend() {
  const url = normalizeBackendUrl(el.backendUrl.value);
  el.settingsStatus.textContent = "Testing…";
  el.settingsStatus.classList.remove("error");
  try {
    const response = await fetch(`${url}/health`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error("Backend not ready");
    state.backendInfo = data;
    el.providerInfo.textContent = `Provider: ${data.provider || "unknown"} · Base: ${data.baseUrl || "-"}`;
    if (!el.modelId.value && data.model) el.modelId.value = data.model;
    el.settingsStatus.textContent = `Connected · ${data.provider || "AI"} · model: ${data.model || "not set"}`;
    if (data.supportsModelList) await refreshModels();
  } catch (error) {
    el.providerInfo.textContent = "";
    el.settingsStatus.textContent = `Connection failed: ${error.message}`;
    el.settingsStatus.classList.add("error");
  }
}

// ===== Event listeners =====
el.sendButton.addEventListener("click", () => {
  const text = el.messageInput.value;
  el.messageInput.value = "";
  el.messageInput.style.height = "auto";
  askAssistant(text);
});

el.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    el.sendButton.click();
  }
});

el.messageInput.addEventListener("input", () => {
  el.messageInput.style.height = "auto";
  el.messageInput.style.height = `${Math.min(el.messageInput.scrollHeight, 140)}px`;
});

document.querySelectorAll("[data-action]").forEach((button) => {
  button.addEventListener("click", () => askAssistant(
    quickPrompt(button.dataset.action),
    true,
    button.dataset.action === "summarize"
  ));
});

el.clearSelectionButton.addEventListener("click", () => {
  state.selection = "";
  state.selectionUrl = "";
  renderSelection();
});

el.addTabContextButton?.addEventListener("click", openTabContextDialog);
el.removeContextTabButton?.addEventListener("click", async () => {
  state.contextTab = null;
  await chrome.storage.local.remove(STORAGE_KEYS.contextTab);
  renderContextTab();
  setStatus("Tab context removed");
});
el.closeTabContextButton?.addEventListener("click", () => el.tabContextDialog.close());

el.readSelectionButton.addEventListener("click", () => {
  if (state.selection) ttsSpeak(state.selection, el.readSelectionButton);
});

el.saveWordButton.addEventListener("click", saveWord);

el.wordsButton.addEventListener("click", openWordsDialog);

el.closeWordsButton.addEventListener("click", () => el.wordsDialog.close());

el.stopTtsButton.addEventListener("click", ttsStop);

el.resetHistoryButton.addEventListener("click", resetSectionHistory);

el.clearChatButton.addEventListener("click", async () => {
  state.messages = [];
  await saveMessages();
  renderMessages();
  setStatus("Chat history cleared");
});

el.sectionSelect.addEventListener("change", () => selectSection(el.sectionSelect.value));
el.deleteSectionButton.addEventListener("click", deleteCurrentSection);

el.newSectionButton.addEventListener("click", () => {
  el.newSectionTitle.value = "";
  el.newSectionPersist.checked = false;
  el.newSectionStatus.textContent = "";
  el.newSectionStatus.classList.remove("error");
  el.newSectionDialog.showModal();
  setTimeout(() => el.newSectionTitle.focus(), 50);
});

el.cancelNewSectionButton.addEventListener("click", () => el.newSectionDialog.close());
el.createSectionButton.addEventListener("click", createNewSection);

el.newSectionTitle.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    createNewSection();
  }
});

el.settingsButton.addEventListener("click", () => {
  el.backendUrl.value = state.settings.backendUrl;
  el.modelId.value = state.settings.model;
  el.systemPrompt.value = state.settings.systemPrompt;
  el.outputLanguage.value = state.settings.outputLanguage;
  shortcutDraft = { ...(state.settings.shortcuts || DEFAULT_SHORTCUTS) };
  renderShortcutInputs(shortcutDraft);
  el.providerInfo.textContent = state.backendInfo
    ? `Provider: ${state.backendInfo.provider || "unknown"} · Base: ${state.backendInfo.baseUrl || "-"}`
    : "";
  el.settingsStatus.textContent = "";
  el.settingsDialog.showModal();
});

el.testBackendButton.addEventListener("click", testBackend);
el.refreshModelsButton.addEventListener("click", refreshModels);
el.resetShortcutsButton?.addEventListener("click", () => {
  shortcutDraft = { ...DEFAULT_SHORTCUTS };
  renderShortcutInputs(shortcutDraft);
  el.settingsStatus.textContent = "Shortcut defaults restored. Click Save to apply.";
  el.settingsStatus.classList.remove("error");
});

el.saveSettingsButton.addEventListener("click", async () => {
  const backendUrl = normalizeBackendUrl(el.backendUrl.value);
  try {
    new URL(backendUrl);
  } catch {
    el.settingsStatus.textContent = "Invalid Backend URL";
    el.settingsStatus.classList.add("error");
    return;
  }
  const shortcuts = readShortcutDraft();
  const shortcutError = validateShortcutDraft(shortcuts);
  if (shortcutError) {
    el.settingsStatus.textContent = shortcutError;
    el.settingsStatus.classList.add("error");
    return;
  }
  endShortcutCapture();
  state.settings = {
    backendUrl,
    model: el.modelId.value.trim(),
    systemPrompt: el.systemPrompt.value.trim(),
    outputLanguage: el.outputLanguage.value.trim(),
    shortcuts: Object.fromEntries(
      SHORTCUT_ACTIONS.map((action) => [action, normalizeShortcut(shortcuts[action])])
    )
  };
  shortcutDraft = { ...state.settings.shortcuts };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: state.settings });
  el.settingsDialog.close();
  setStatus(`Backend: ${new URL(backendUrl).host}${state.settings.model ? ` · ${state.settings.model}` : ""}`);
  await fetchSections();
  if (state.activeSection) {
    el.sectionSelect.value = state.activeSection.sectionKey;
  }
});

// Shortcut capture fields: click/focus a field, then press any key combination.
for (const action of SHORTCUT_ACTIONS) {
  const input = shortcutInput(action);
  if (!input) continue;
  input.addEventListener("focus", () => beginShortcutCapture(input));
  input.addEventListener("click", () => beginShortcutCapture(input));
  input.addEventListener("blur", () => {
    if (shortcutCaptureInput !== input) return;
    input.value = normalizeShortcut(shortcutDraft[action] || "");
    endShortcutCapture();
  });
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const update = changes[STORAGE_KEYS.pendingSelection]?.newValue || changes[STORAGE_KEYS.lastSelection]?.newValue;
  if (update?.text) {
    state.selection = update.text;
    state.selectionUrl = update.url || state.context?.url || "";
    if (state.context) state.context.selection = update.text;
    renderSelection();
    void persistSectionContext();
    if (changes[STORAGE_KEYS.pendingSelection]?.newValue) {
      await chrome.storage.local.remove(STORAGE_KEYS.pendingSelection);
    }
  }
  const saveWord = changes[STORAGE_KEYS.pendingSaveWord]?.newValue;
  if (saveWord?.text) {
    state.selection = saveWord.text;
    state.selectionUrl = saveWord.url || state.context?.url || "";
    if (saveWord.title || saveWord.url) {
      state.context = state.context || {};
      state.context.title = saveWord.title || state.context.title || "";
      state.context.url = saveWord.url || state.context.url || "";
    }
    renderSelection();
    void persistSectionContext();
    saveWordToApi(saveWord.text, saveWord.url, saveWord.title);
    await chrome.storage.local.remove(STORAGE_KEYS.pendingSaveWord);
  }
  const action = changes[STORAGE_KEYS.pendingAction]?.newValue;
  if (action?.action) {
    if (action.text) {
      state.selection = action.text;
      state.selectionUrl = action.url || "";
      renderSelection();
    }
    await refreshPageContext();
    askAssistant(quickPrompt(action.action), true, action.action === "summarize");
    await chrome.storage.local.remove(STORAGE_KEYS.pendingAction);
  }
});

chrome.tabs.onActivated.addListener(() => refreshPageContext());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") refreshPageContext();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === state.contextTab?.tabId && changeInfo.status === "complete") {
    refreshContextTab();
  }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== state.contextTab?.tabId) return;
  state.contextTab = null;
  chrome.storage.local.remove(STORAGE_KEYS.contextTab);
  renderContextTab();
});

// Save word directly (used by context menu storage listener)
async function saveWordToApi(text, sourceUrl, sourceTitle) {
  try {
    const result = await saveWordRecord(text, sourceUrl, sourceTitle);
    const suffix = result.translation ? ` → ${result.translation}` : " (translation unavailable)";
    setStatus(`Saved word: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"${suffix}`);
  } catch (err) {
    setStatus(`Save word error: ${err.message}`, true);
  }
}

// ===== In-panel keyboard shortcuts (configurable) =====
document.addEventListener("keydown", (event) => {
  const shortcutTarget = event.target?.classList?.contains("shortcut-input")
    ? event.target
    : null;
  if (shortcutTarget) {
    const action = SHORTCUT_ACTIONS.find((name) => shortcutInput(name) === shortcutTarget);
    if (!action) return;
    if (shortcutCaptureInput !== shortcutTarget) beginShortcutCapture(shortcutTarget);
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      shortcutDraft[action] = "";
      shortcutTarget.value = "";
      endShortcutCapture();
      return;
    }
    const combo = formatCombo(event);
    if (!combo) {
      // Keep the previous value while waiting for a non-modifier key.
      shortcutTarget.value = normalizeShortcut(shortcutDraft[action] || "");
      return;
    }
    shortcutDraft[action] = combo;
    shortcutTarget.value = combo;
    endShortcutCapture();
    return;
  }

  // Don't interfere when typing in inputs/textareas (except shortcut capture mode)
  const tag = event.target?.tagName?.toLowerCase();
  const isTyping = tag === "input" || tag === "textarea" || tag === "select" || event.target?.isContentEditable;
  if (isTyping && !event.target?.classList?.contains("shortcut-input")) return;

  const sc = state.settings.shortcuts || DEFAULT_SHORTCUTS;

  if (comboMatchesEvent(sc.explain, event)) {
    event.preventDefault();
    askAssistant(quickPrompt("explain"), true);
    return;
  }
  if (comboMatchesEvent(sc.translate, event)) {
    event.preventDefault();
    askAssistant(quickPrompt("translate"), true);
    return;
  }
  if (comboMatchesEvent(sc.summarize, event)) {
    event.preventDefault();
    askAssistant(quickPrompt("summarize"), true, true);
    return;
  }
  if (comboMatchesEvent(sc.saveWord, event)) {
    event.preventDefault();
    saveWord();
    return;
  }
  if (comboMatchesEvent(sc.readAloud, event)) {
    event.preventDefault();
    if (state.selection) ttsSpeak(state.selection, el.readSelectionButton);
    return;
  }
  if (comboMatchesEvent(sc.stopTts, event)) {
    if (tts.speaking) {
      event.preventDefault();
      ttsStop();
    }
    return;
  }
});

// ===== Init =====
async function init() {
  await loadState();
  await fetchSections();
  if (state.activeSection) {
    el.sectionSelect.value = state.activeSection.sectionKey;
    if (state.activeSection.persistHistory) {
      await selectSection(state.activeSection.sectionKey);
    }
  }
  await testBackend();
}

init().catch((error) => {
  setStatus(`Init error: ${error.message}`, true);
});
