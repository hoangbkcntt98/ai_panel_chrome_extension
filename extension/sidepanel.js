const DEFAULT_BACKEND_URL = "http://localhost:8787";
const STORAGE_KEYS = {
  messages: "chatMessages",
  settings: "assistantSettings",
  lastSelection: "lastSelection",
  pendingSelection: "pendingSelection",
  activeSection: "activeSection"
};

const state = {
  messages: [],
  selection: "",
  context: null,
  loading: false,
  settings: {
    backendUrl: DEFAULT_BACKEND_URL,
    model: "",
    systemPrompt: "",
    outputLanguage: ""
  },
  backendInfo: null,
  activeSection: null,   // { sectionKey, title, persistHistory }
  sections: []
};

const el = {
  chat: document.querySelector("#chat"),
  messageTemplate: document.querySelector("#messageTemplate"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  includeContext: document.querySelector("#includeContext"),
  statusText: document.querySelector("#statusText"),
  pageLabel: document.querySelector("#pageLabel"),
  selectionCard: document.querySelector("#selectionCard"),
  selectionText: document.querySelector("#selectionText"),
  clearSelectionButton: document.querySelector("#clearSelectionButton"),
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
  stopTtsButton: document.querySelector("#stopTtsButton"),
  resetHistoryButton: document.querySelector("#resetHistoryButton"),
  // Section management
  sectionSelect: document.querySelector("#sectionSelect"),
  newSectionButton: document.querySelector("#newSectionButton"),
  newSectionDialog: document.querySelector("#newSectionDialog"),
  newSectionTitle: document.querySelector("#newSectionTitle"),
  newSectionPersist: document.querySelector("#newSectionPersist"),
  cancelNewSectionButton: document.querySelector("#cancelNewSectionButton"),
  createSectionButton: document.querySelector("#createSectionButton"),
  newSectionStatus: document.querySelector("#newSectionStatus")
};

function normalizeBackendUrl(url) {
  return (url || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
}

function getApiBase() {
  return state.settings.backendUrl;
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
}

async function selectSection(sectionKey) {
  // Save current section's messages before switching
  await persistCurrentSection();

  if (!sectionKey) {
    state.activeSection = null;
    state.messages = [];
    el.resetHistoryButton.classList.add("hidden");
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
    persistHistory: sec.persist_history
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.activeSection]: state.activeSection });

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
  try {
    await fetch(`${getApiBase()}/api/sections/${encodeURIComponent(sectionKey)}`, { method: "DELETE" });
    state.activeSection = null;
    state.messages = [];
    await chrome.storage.local.set({
      [STORAGE_KEYS.messages]: [],
      [STORAGE_KEYS.activeSection]: null
    });
    await fetchSections();
    renderMessages();
    setStatus("Section deleted");
  } catch (err) {
    setStatus(`Delete error: ${err.message}`, true);
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
  state.settings = {
    backendUrl: normalizeBackendUrl(stored[STORAGE_KEYS.settings]?.backendUrl || DEFAULT_BACKEND_URL),
    model: String(stored[STORAGE_KEYS.settings]?.model || "").trim(),
    systemPrompt: String(stored[STORAGE_KEYS.settings]?.systemPrompt || "").trim(),
    outputLanguage: String(stored[STORAGE_KEYS.settings]?.outputLanguage || "").trim()
  };

  const selectionCandidate = stored[STORAGE_KEYS.pendingSelection] || stored[STORAGE_KEYS.lastSelection];
  if (selectionCandidate?.text) state.selection = selectionCandidate.text;
  if (stored[STORAGE_KEYS.pendingSelection]) {
    await chrome.storage.local.remove(STORAGE_KEYS.pendingSelection);
  }

  el.backendUrl.value = state.settings.backendUrl;
  el.modelId.value = state.settings.model;
  el.systemPrompt.value = state.settings.systemPrompt;
  el.outputLanguage.value = state.settings.outputLanguage;

  state.activeSection = stored[STORAGE_KEYS.activeSection] || null;

  renderMessages();
  renderSelection();
  await refreshPageContext();
}

async function refreshPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error("No active tab found");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
    if (!response?.ok) throw new Error("Page does not support reading content");
    state.context = response.context;
    if (response.context.selection) state.selection = response.context.selection;
    el.pageLabel.textContent = response.context.title || "Current page";
    renderSelection();
  } catch {
    state.context = null;
    el.pageLabel.textContent = "This page does not allow reading content";
  }
}

function buildContextPayload(force = false) {
  if (!force && !el.includeContext.checked) return null;
  const context = state.context || {};
  return {
    title: context.title || "",
    url: context.url || "",
    selection: state.selection || context.selection || "",
    pageText: context.pageText || ""
  };
}

// ===== Chat =====
async function askAssistant(text, forceContext = false) {
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
    const response = await fetch(`${getApiBase()}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: state.messages.slice(-12),
        context: buildContextPayload(forceContext),
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
    return "Summarize the page provided in the context below. Provide: main points, key takeaways, and 3 bullet-point action items or notes if applicable. Base your summary ONLY on the page content, not on prior knowledge.";
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
  button.addEventListener("click", () => askAssistant(quickPrompt(button.dataset.action), true));
});

el.clearSelectionButton.addEventListener("click", () => {
  state.selection = "";
  renderSelection();
});

el.stopTtsButton.addEventListener("click", ttsStop);

el.resetHistoryButton.addEventListener("click", resetSectionHistory);

el.clearChatButton.addEventListener("click", async () => {
  state.messages = [];
  await saveMessages();
  renderMessages();
  setStatus("Chat history cleared");
});

el.sectionSelect.addEventListener("change", () => selectSection(el.sectionSelect.value));

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
  el.providerInfo.textContent = state.backendInfo
    ? `Provider: ${state.backendInfo.provider || "unknown"} · Base: ${state.backendInfo.baseUrl || "-"}`
    : "";
  el.settingsStatus.textContent = "";
  el.settingsDialog.showModal();
});

el.testBackendButton.addEventListener("click", testBackend);
el.refreshModelsButton.addEventListener("click", refreshModels);

el.saveSettingsButton.addEventListener("click", async () => {
  const backendUrl = normalizeBackendUrl(el.backendUrl.value);
  try {
    new URL(backendUrl);
  } catch {
    el.settingsStatus.textContent = "Invalid Backend URL";
    el.settingsStatus.classList.add("error");
    return;
  }
  state.settings = {
    backendUrl,
    model: el.modelId.value.trim(),
    systemPrompt: el.systemPrompt.value.trim(),
    outputLanguage: el.outputLanguage.value.trim()
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: state.settings });
  el.settingsDialog.close();
  setStatus(`Backend: ${new URL(backendUrl).host}${state.settings.model ? ` · ${state.settings.model}` : ""}`);
  await fetchSections();
  if (state.activeSection) {
    el.sectionSelect.value = state.activeSection.sectionKey;
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const update = changes[STORAGE_KEYS.pendingSelection]?.newValue || changes[STORAGE_KEYS.lastSelection]?.newValue;
  if (update?.text) {
    state.selection = update.text;
    renderSelection();
  }
});

chrome.tabs.onActivated.addListener(() => refreshPageContext());
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete") refreshPageContext();
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
