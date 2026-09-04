const DEFAULT_BACKEND_URL = "http://localhost:8787";
const STORAGE_KEYS = {
  messages: "chatMessages",
  settings: "assistantSettings",
  lastSelection: "lastSelection",
  pendingSelection: "pendingSelection"
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
  backendInfo: null
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
  settingsStatus: document.querySelector("#settingsStatus")
};

function normalizeBackendUrl(url) {
  return (url || DEFAULT_BACKEND_URL).trim().replace(/\/+$/, "");
}

// Simple markdown to HTML converter
function parseMarkdown(text) {
  if (!text) return '';
  
  let html = text
    // Escape HTML first
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/_(.+?)_/g, '<em>$1</em>')
    // Code: `text`
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // Headers: ### text, ## text, # text
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // Links: [text](url)
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    // Unordered lists: - item or * item
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    // Line breaks: two spaces at end or \n\n
    .replace(/  \n/g, '<br>')
    .replace(/\n\n/g, '</p><p>')
    // Single line break
    .replace(/\n/g, '<br>');
  
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*?<\/li>\s*)+/g, '<ul>$&</ul>');
  
  return '<p>' + html + '</p>';
}

function setStatus(text, isError = false) {
  el.statusText.textContent = text;
  el.statusText.classList.toggle("error", isError);
}

function showEmptyState() {
  el.chat.replaceChildren();
  const wrapper = document.createElement("div");
  wrapper.className = "empty-state";
  wrapper.innerHTML = `
    <div class="sparkle">✦</div>
    <h2>Hỏi ngay trên trang đang mở</h2>
    <p>Bôi đen một đoạn văn rồi chọn "Giải thích", "Dịch → VI", hoặc đặt câu hỏi ở ô bên dưới.</p>
  `;
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
    node.querySelector(".message-role").textContent = message.role === "user" ? "Bạn" : "AI";
    node.querySelector(".message-body").innerHTML = parseMarkdown(message.content);
    el.chat.appendChild(node);
  }

  if (state.loading) {
    const loading = el.messageTemplate.content.firstElementChild.cloneNode(true);
    loading.classList.add("assistant", "loading");
    loading.querySelector(".message-role").textContent = "AI";
    loading.querySelector(".message-body").textContent = "Đang suy nghĩ";
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

async function saveMessages() {
  await chrome.storage.local.set({ [STORAGE_KEYS.messages]: state.messages.slice(-40) });
}

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
 renderMessages();
  renderSelection();
  await refreshPageContext();
}

async function refreshPageContext() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab?.id) throw new Error("Không tìm thấy tab đang mở");

    const response = await chrome.tabs.sendMessage(tab.id, { type: "GET_PAGE_CONTEXT" });
    if (!response?.ok) throw new Error("Trang không hỗ trợ đọc nội dung");

    state.context = response.context;
    if (response.context.selection) state.selection = response.context.selection;
    el.pageLabel.textContent = response.context.title || "Trang hiện tại";
    renderSelection();
  } catch {
    state.context = null;
    el.pageLabel.textContent = "Trang này không cho phép đọc nội dung";
  }
}

function buildContextPayload() {
  if (!el.includeContext.checked) return null;
  const context = state.context || {};
  return {
    title: context.title || "",
    url: context.url || "",
    selection: state.selection || context.selection || "",
    pageText: context.pageText || ""
  };
}

async function askAssistant(text) {
  const content = (text || "").trim();
  if (!content || state.loading) return;

  state.loading = true;
  el.sendButton.disabled = true;
  state.messages.push({ role: "user", content });
  await saveMessages();
  renderMessages();
  setStatus("Đang gửi tới backend…");

  try {
    await refreshPageContext();
    const response = await fetch(`${state.settings.backendUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
     body: JSON.stringify({
       messages: state.messages.slice(-12),
       context: buildContextPayload(),
       model: state.settings.model || undefined,
       systemPrompt: state.settings.systemPrompt || undefined,
       outputLanguage: state.settings.outputLanguage || undefined
     })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Backend trả về HTTP ${response.status}`);
    }

    if (!data.text) throw new Error("Backend không trả về nội dung");
    state.messages.push({ role: "assistant", content: data.text });
    if (data.model && !state.settings.model) {
      state.settings.model = data.model;
      await chrome.storage.local.set({ [STORAGE_KEYS.settings]: state.settings });
    }
    await saveMessages();
    const modelLabel = data.model ? ` · ${data.model}` : "";
    setStatus(`Đã trả lời · ${data.provider || "AI"}${modelLabel}`);
  } catch (error) {
    state.messages.push({
      role: "assistant",
      content: `Không thể kết nối trợ lý. ${error.message}\n\nHãy mở ⚙ và kiểm tra Backend URL / API key.`
    });
    await saveMessages();
    setStatus("Có lỗi khi gọi backend", true);
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
      ? `Giải thích đoạn sau thật dễ hiểu, nêu ý chính và ví dụ nếu hữu ích:\n\n${selected}`
      : "Giải thích nội dung chính của trang này thật dễ hiểu, tập trung vào các khái niệm quan trọng.";
  }
  if (action === "translate") {
    return selected
      ? `Dịch đoạn sau sang tiếng Việt tự nhiên, giữ đúng nghĩa và giải thích nhanh các thuật ngữ khó nếu có:\n\n${selected}`
      : "Hãy dịch và diễn giải ngắn gọn phần nội dung quan trọng nhất của trang này sang tiếng Việt.";
  }
  if (action === "summarize") {
    return "Tóm tắt trang này bằng tiếng Việt: ý chính, các điểm cần nhớ và 3 gạch đầu dòng hành động/ghi nhớ nếu phù hợp.";
  }
  return "";
}

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
  el.settingsStatus.textContent = "Đang tải danh sách model…";
  el.settingsStatus.classList.remove("error");
  try {
    const response = await fetch(`${url}/models`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const models = Array.isArray(data.models) ? data.models : [];
    renderModelOptions(models);
    if (!el.modelId.value && data.defaultModel) el.modelId.value = data.defaultModel;
    el.settingsStatus.textContent = models.length
      ? `Đã tải ${models.length} model từ ${data.provider || "backend"}`
      : "Backend chưa trả về danh sách model; bạn vẫn có thể nhập Model ID thủ công.";
  } catch (error) {
    el.settingsStatus.textContent = `Không lấy được model: ${error.message}`;
    el.settingsStatus.classList.add("error");
  } finally {
    el.refreshModelsButton.disabled = false;
  }
}

async function testBackend() {
  const url = normalizeBackendUrl(el.backendUrl.value);
  el.settingsStatus.textContent = "Đang kiểm tra…";
  el.settingsStatus.classList.remove("error");
  try {
    const response = await fetch(`${url}/health`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error("Backend chưa sẵn sàng");
    state.backendInfo = data;
    el.providerInfo.textContent = `Provider: ${data.provider || "không rõ"} · Base: ${data.baseUrl || "-"}`;
    if (!el.modelId.value && data.model) el.modelId.value = data.model;
    el.settingsStatus.textContent = `Kết nối OK · ${data.provider || "AI"} · model: ${data.model || "chưa chọn"}`;
    if (data.supportsModelList) await refreshModels();
  } catch (error) {
    el.providerInfo.textContent = "";
    el.settingsStatus.textContent = `Không kết nối được: ${error.message}`;
    el.settingsStatus.classList.add("error");
  }
}

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
  button.addEventListener("click", () => askAssistant(quickPrompt(button.dataset.action)));
});

el.clearSelectionButton.addEventListener("click", () => {
  state.selection = "";
  renderSelection();
});

el.clearChatButton.addEventListener("click", async () => {
  state.messages = [];
  await saveMessages();
  renderMessages();
  setStatus("Đã xóa lịch sử chat");
});

el.settingsButton.addEventListener("click", () => {
 el.backendUrl.value = state.settings.backendUrl;
 el.modelId.value = state.settings.model;
 el.systemPrompt.value = state.settings.systemPrompt;
 el.outputLanguage.value = state.settings.outputLanguage;
 el.providerInfo.textContent = state.backendInfo
    ? `Provider: ${state.backendInfo.provider || "không rõ"} · Base: ${state.backendInfo.baseUrl || "-"}`
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
    el.settingsStatus.textContent = "Backend URL không hợp lệ";
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

loadState().then(() => testBackend()).catch((error) => {
  setStatus(`Lỗi khởi tạo: ${error.message}`, true);
});
