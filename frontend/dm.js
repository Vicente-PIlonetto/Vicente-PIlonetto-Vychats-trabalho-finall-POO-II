const App = window.CipherlineApp;
const activeContextEyebrow = document.getElementById("activeContextEyebrow");
const activeServerName = document.getElementById("activeServerName");
const memberCountChip = document.getElementById("memberCountChip");
const socketStatusChip = document.getElementById("socketStatusChip");
const directMessagesList = document.getElementById("directMessagesList");
const messagesContainer = document.getElementById("messages");
const composerForm = document.getElementById("composerForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const attachButton = document.getElementById("attachButton");
const audioButton = document.getElementById("audioButton");
const attachmentInput = document.getElementById("attachmentInput");
const attachmentList = document.getElementById("attachmentList");
const socketEndpointDisplay = document.getElementById("socketEndpointDisplay");
const disconnectSocketButton = document.getElementById("disconnectSocketButton");
const transportHint = document.getElementById("transportHint");
const composerContext = document.getElementById("composerContext");
const mediaLightbox = ensureMediaLightbox();

let currentUser = null;
let activeChat = null;
let directConversations = [];
let socket = null;
let isConnecting = false;
let reconnectTimer = null;
let manuallyDisconnected = false;
let pendingAttachments = [];
let isUploadingAttachments = false;
let mediaRecorder = null;
let recordingStream = null;
let recordingChunks = [];
let isRecording = false;
let replyDraft = null;
let editDraft = null;
const MAX_ATTACHMENTS = 5;
let sideRefreshTimer = 0;
const renderedMessageKeys = new Set();
const pendingOwnMessages = new Map();
const queuedMessages = [];

App.initLanguage();
App.initTheme();
App.registerServiceWorker();
bootstrap();

composerForm.addEventListener("submit", handleSendMessage);
attachButton.addEventListener("click", () => attachmentInput.click());
audioButton?.addEventListener("click", toggleVoiceRecording);
attachmentInput.addEventListener("change", () => {
  handleSelectedAttachment(attachmentInput.files || null);
});
disconnectSocketButton.addEventListener("click", () => {
  if (manuallyDisconnected || !socket || socket.readyState === WebSocket.CLOSED) {
    manuallyDisconnected = false;
    connectSocket();
    return;
  }
  manuallyDisconnected = true;
  disconnectSocket();
  setSocketStatus(App.t("state_socket_offline"));
  setTransportHint(App.t("helper_transport_disconnected"));
  updateConnectionActionButton();
});
window.addEventListener("cipherline:languagechange", () => {
  if (currentUser) {
    App.renderSidebar({ activePage: "dms", user: currentUser });
  }
  renderDirectConversations();
  renderActiveChat();
  refreshSocketLabels();
  renderComposerContext();
  updateRecordingButton();
  updateAttachmentState();
  updateUnreadIndicators();
});
window.addEventListener("cipherline:userchange", (event) => {
  currentUser = event.detail.user;
  App.renderSidebar({ activePage: "dms", user: currentUser });
  renderDirectConversations();
  renderActiveChat();
});
window.addEventListener("visibilitychange", () => {
  if (canMarkActiveChatRead()) {
    void syncActiveConversationReadState();
  }
});
window.addEventListener("focus", () => {
  if (canMarkActiveChatRead()) {
    void syncActiveConversationReadState();
  }
});
messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composerForm.requestSubmit();
  }
});
messageInput.addEventListener("paste", handlePasteAttachment);

async function bootstrap() {
  currentUser = await App.requireSession();
  if (!currentUser) {
    return;
  }

  App.renderSidebar({ activePage: "dms", user: currentUser });
  void App.ensureNotificationPermission();
  if (socketEndpointDisplay) {
    socketEndpointDisplay.textContent = App.getDefaultSocketEndpoint();
  }
  setTransportHint(App.t("helper_transport_click_connect"));

  await refreshSideData();
  if (!sideRefreshTimer) {
    sideRefreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshSideData();
      }
    }, 10000);
  }

  const activeDirectUserId = App.getActiveDirectMessageUserId();
  if (activeDirectUserId) {
    await loadDirectMessageChat(activeDirectUserId);
    return;
  }

  window.location.href = "/dm-users";
}

async function refreshSideData() {
  const directPayload = await App.apiFetch("/dms");
  directConversations = directPayload.conversations;
  if (activeChat) {
    const activeConversation = directConversations.find((conversation) => conversation.id === activeChat.user.id);
    activeChat.unreadCount = Number(activeConversation?.unread_count || 0);
  }
  renderDirectConversations();
  updateUnreadIndicators();
}

function renderDirectConversations() {
  if (!directConversations.length) {
    directMessagesList.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_direct_messages"))}</div>`;
    return;
  }

  directMessagesList.innerHTML = directConversations.map((conversation) => {
    const isActive = activeChat?.user.id === conversation.id;
    const lastMessage = conversation.last_message;
    const preview = lastMessage?.deleted
      ? App.t("state_message_deleted")
      : (lastMessage?.content || getMessageAttachments(lastMessage)[0]?.name || "");
    const unreadCount = Number(conversation.unread_count || 0);
    return `
      <div class="member-item ${isActive ? "active" : ""} ${unreadCount ? "unread" : ""}">
        <div class="member-preview-row">
          <div class="member-profile-row member-preview-text">
            ${renderMemberAvatar(conversation)}
            <div class="member-text-stack">
              <strong>${App.escapeHtml(conversation.username)}</strong>
              ${renderUserStatus(conversation)}
            </div>
          </div>
          ${unreadCount ? `<span class="unread-badge">${App.escapeHtml(String(unreadCount > 99 ? "99+" : unreadCount))}</span>` : ""}
        </div>
        <div class="member-item-row">
          <button class="member-action ghost" data-open-dm="${conversation.id}">${App.escapeHtml(App.t("button_open_chat"))}</button>
        </div>
        <div class="small-text">${App.escapeHtml(preview.slice(0, 48) || App.t("state_no_direct_messages"))}</div>
      </div>
    `;
  }).join("");

  document.querySelectorAll("[data-open-dm]").forEach((button) => {
    button.addEventListener("click", async () => {
      App.setActiveDirectMessageUserId(button.dataset.openDm);
      await loadDirectMessageChat(button.dataset.openDm);
      connectSocket();
    });
  });
}

function renderMemberAvatar(user) {
  if (user.avatar_url) {
    return `<img class="member-avatar" src="${App.escapeHtml(user.avatar_url)}" alt="${App.escapeHtml(user.username)}">`;
  }
  return `<div class="member-avatar-fallback">${App.escapeHtml(App.getInitials(user.username))}</div>`;
}

function renderUserStatus(user) {
  const isOnline = Boolean(user?.is_online);
  const statusMode = (user?.status_mode || (isOnline ? "online" : "offline")).toLowerCase();
  const fallbackLabel = App.t(isOnline ? "state_user_online" : "state_user_offline");
  const label = (user?.status_text || "").trim() || App.t(`state_status_${statusMode}`) || fallbackLabel;
  return `
    <span class="user-status is-${App.escapeHtml(statusMode)}">
      ${App.escapeHtml(label)}
    </span>
  `;
}
async function loadDirectMessageChat(otherUserId) {
  manuallyDisconnected = false;
  disconnectSocket();
  const payload = await App.apiFetch(`/dms/${otherUserId}`);
  activeChat = {
    id: payload.conversation.id,
    user: payload.conversation.user,
    name: App.t("state_direct_with", { username: payload.conversation.user.username }),
    memberCount: 2,
    messages: payload.conversation.messages,
    unreadCount: Number(payload.conversation.unread_count || 0),
  };
  App.setActiveDirectMessageUserId(otherUserId);
  renderActiveChat();
  await refreshSideData();
  connectSocket();
}

function renderEmptyDirectMessageState() {
  manuallyDisconnected = false;
  activeChat = null;
  clearComposerDrafts();
  activeContextEyebrow.textContent = App.t("state_active_direct");
  activeServerName.textContent = App.t("heading_no_direct_selected");
  memberCountChip.textContent = App.t("state_members_count", { count: 0 });
  messagesContainer.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_select_direct_conversation"))}</div>`;
  messageInput.disabled = true;
  sendButton.disabled = true;
  updateUnreadIndicators();
}

function renderActiveChat() {
  if (!activeChat) {
    renderEmptyDirectMessageState();
    return;
  }

  clearComposerDrafts();
  activeContextEyebrow.textContent = App.t("state_active_direct");
  activeServerName.textContent = activeChat.name;
  memberCountChip.textContent = App.t("state_members_count", { count: activeChat.memberCount });
  renderedMessageKeys.clear();
  pendingOwnMessages.clear();

  if (!activeChat.messages.length) {
    messagesContainer.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_direct_messages"))}</div>`;
  } else {
    messagesContainer.innerHTML = "";
    activeChat.messages.forEach((message) => appendMessage(message));
  }
  updateConnectionActionButton();
  updateUnreadIndicators();
}

function renderComposerContext() {
  if (!composerContext) {
    return;
  }
  if (editDraft) {
    composerContext.classList.remove("hidden");
    composerContext.innerHTML = `
      <div class="composer-context-row">
        <strong>${App.escapeHtml(App.t("state_editing_message"))}</strong>
        <button type="button" class="ghost" data-cancel-edit="1">${App.escapeHtml(App.t("button_cancel"))}</button>
      </div>
    `;
  } else if (replyDraft) {
    const label = App.t("state_replying_to", { username: replyDraft.username || App.t("state_system") });
    const snippet = buildReplySnippetText(replyDraft);
    composerContext.classList.remove("hidden");
    composerContext.innerHTML = `
      <div class="composer-context-row">
        <strong>${App.escapeHtml(label)}</strong>
        <button type="button" class="ghost" data-cancel-reply="1">${App.escapeHtml(App.t("button_cancel"))}</button>
      </div>
      <div class="small-text">${App.escapeHtml(snippet)}</div>
    `;
  } else {
    composerContext.classList.add("hidden");
    composerContext.innerHTML = "";
  }

  composerContext.querySelectorAll("[data-cancel-edit]").forEach((button) => {
    button.addEventListener("click", clearComposerDrafts);
  });
  composerContext.querySelectorAll("[data-cancel-reply]").forEach((button) => {
    button.addEventListener("click", clearComposerDrafts);
  });
}

function clearComposerDrafts() {
  replyDraft = null;
  editDraft = null;
  renderComposerContext();
}

function setReplyDraft(message) {
  if (!message?.message_id) {
    return;
  }
  editDraft = null;
  const attachments = getMessageAttachments(message);
  replyDraft = {
    message_id: message.message_id,
    user_id: message.user_id,
    username: message.username,
    content: message.content || "",
    deleted: Boolean(message.deleted),
    attachment: attachments[0] || null,
  };
  renderComposerContext();
  messageInput.focus();
}

function setEditDraft(message) {
  if (!message?.message_id) {
    return;
  }
  replyDraft = null;
  editDraft = {
    message_id: message.message_id,
  };
  messageInput.value = message.content || "";
  clearAttachment();
  renderComposerContext();
  messageInput.focus();
}

function buildReplySnippetText(message) {
  if (message?.deleted) {
    return App.t("state_message_deleted");
  }
  if (message?.content) {
    return message.content.trim().slice(0, 120);
  }
  const attachments = getMessageAttachments(message);
  if (attachments.length) {
    return attachments[0].name || App.t("state_attachment_file");
  }
  return App.t("state_attachment_file");
}

function connectSocket() {
  if (!activeChat || isConnecting) {
    return;
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  disconnectSocket();
  const endpoint = buildSocketUrl();
  if (socketEndpointDisplay) {
    socketEndpointDisplay.textContent = endpoint.replace(/\?.*$/, "");
  }
  isConnecting = true;
  socket = new WebSocket(endpoint);
  setSocketStatus(App.t("state_socket_connecting"));
  setTransportHint(App.t("helper_transport_connecting"));

  socket.addEventListener("open", () => {
    isConnecting = false;
    setSocketStatus(App.t("state_socket_online"));
    setTransportHint(App.t("helper_transport_connected"));
    messageInput.disabled = false;
    sendButton.disabled = false;
    updateConnectionActionButton();
    flushQueuedMessages();
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleIncomingConversationMessage(payload);
    } catch (error) {
      addSystemMessage(App.t("chat_decode_error", { message: error.message }));
    }
  });

  socket.addEventListener("close", (event) => {
    isConnecting = false;
    setSocketStatus(App.t("state_socket_offline"));
    setTransportHint(event.reason
      ? App.t("chat_socket_closed_reason", { reason: event.reason })
      : App.t("chat_socket_closed"));
    messageInput.disabled = true;
    sendButton.disabled = true;
    socket = null;
    updateConnectionActionButton();
    if (!manuallyDisconnected && activeChat) {
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectSocket();
      }, 1500);
    }
  });

  socket.addEventListener("error", () => {
    isConnecting = false;
    setSocketStatus(App.t("state_socket_error"));
    setTransportHint(App.t("helper_transport_failed"));
    updateConnectionActionButton();
  });
}

function buildSocketUrl() {
  const base = App.getDefaultSocketEndpoint();
  const token = encodeURIComponent(App.getToken());
  return `${base}/dm/${encodeURIComponent(activeChat.user.id)}?token=${token}`;
}

function disconnectSocket() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.close();
    socket = null;
  }
  isConnecting = false;
  messageInput.disabled = true;
  sendButton.disabled = true;
  updateConnectionActionButton();
  void refreshSideData();
}

function setSocketStatus(value) {
  socketStatusChip.textContent = value;
  if (!socketStatusChip) {
    return;
  }
  const normalized = String(value || "").toLowerCase();
  let state = "offline";
  if (normalized.includes("online")) state = "online";
  else if (normalized.includes("connect")) state = "connecting";
  else if (normalized.includes("conect")) state = "connecting";
  else if (normalized.includes("erro") || normalized.includes("error")) state = "error";
  socketStatusChip.dataset.state = state;
}

function setTransportHint(value) {
  if (transportHint) {
    transportHint.textContent = value;
  }
}

function updateConnectionActionButton() {
  if (!disconnectSocketButton) {
    return;
  }
  const shouldShowConnect = manuallyDisconnected || !socket || socket.readyState === WebSocket.CLOSED;
  disconnectSocketButton.textContent = shouldShowConnect ? App.t("button_connect") : App.t("button_disconnect");
}

function appendMessage(message) {
  if (reconcilePendingOwnMessage(message)) {
    return;
  }

  const messageKey = getMessageKey(message);
  if (messageKey && renderedMessageKeys.has(messageKey)) {
    return;
  }

  const isOwn = message.type === "message" && message.user_id === currentUser.id;
  const variant = message.type === "system" ? "system" : isOwn ? "self" : "remote";
  const empty = messagesContainer.querySelector(".empty-state");
  if (empty) {
    empty.remove();
  }
  const displayContent = getDisplayContent(message);
  const displayHtml = formatMessageContent(displayContent);
  const replySnippet = renderReplySnippet(message.reply_to);
  const messageActions = renderMessageActions(message, isOwn);

  const card = document.createElement("article");
  card.className = `message-card ${variant}`;
  card.innerHTML = message.type === "system" ? `
    <div class="message-meta">
      <span>${App.escapeHtml(App.t("state_system"))}</span>
      <span class="message-meta-right">
        <span>${App.formatTime(message.created_at)}</span>
        ${message.edited_at ? `<span class="message-edited">${App.escapeHtml(App.t("state_message_edited"))}</span>` : ""}
      </span>
    </div>
    ${displayHtml ? `<div class="message-text">${displayHtml}</div>` : ""}
    ${renderAttachment(message)}
  ` : `
    <div class="message-body">
      ${renderMessageAvatar(message, isOwn)}
      <div class="message-content">
        <div class="message-meta">
          <span>${isOwn ? App.escapeHtml(App.t("state_you")) : App.escapeHtml(message.username)}</span>
          <span class="message-meta-right">
            <span>${App.formatTime(message.created_at)}</span>
            ${message.edited_at ? `<span class="message-edited">${App.escapeHtml(App.t("state_message_edited"))}</span>` : ""}
          </span>
        </div>
        ${replySnippet}
        ${displayHtml ? `<div class="message-text">${displayHtml}</div>` : ""}
        ${renderAttachment(message)}
        ${messageActions}
      </div>
    </div>
  `;
  messagesContainer.appendChild(card);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  if (messageKey) {
    renderedMessageKeys.add(messageKey);
  }

  if (message.client_message_id) {
    card.dataset.clientMessageId = message.client_message_id;
  }
  if (message.message_id) {
    card.dataset.messageId = message.message_id;
  }
  bindMessageActions(card, message, isOwn);
  bindMediaPreview(card, message);
}

function renderMessageAvatar(message, isOwn) {
  const label = isOwn ? App.t("state_you") : (message.username || App.t("state_attachment_file"));
  const initials = App.getInitials ? App.getInitials(message.username || label) : (message.username || label).slice(0, 1).toUpperCase();
  const avatarUrl = resolveMessageAvatarUrl(message, isOwn);
  if (avatarUrl) {
    return `<img class="message-avatar" src="${App.escapeHtml(avatarUrl)}" alt="${App.escapeHtml(label)}">`;
  }
  return `<div class="message-avatar-fallback">${App.escapeHtml(initials)}</div>`;
}

function ensureMediaLightbox() {
  const existing = document.querySelector(".media-lightbox");
  if (existing) {
    return existing;
  }
  const lightbox = document.createElement("div");
  lightbox.className = "media-lightbox hidden";
  lightbox.innerHTML = `<div class="media-lightbox-content"></div>`;
  lightbox.addEventListener("click", () => {
    lightbox.classList.add("hidden");
    lightbox.querySelector(".media-lightbox-content").innerHTML = "";
  });
  document.body.appendChild(lightbox);
  return lightbox;
}

function openImageLightbox(url, altText = "") {
  if (!mediaLightbox) {
    return;
  }
  const content = mediaLightbox.querySelector(".media-lightbox-content");
  content.innerHTML = `<img src="${App.escapeHtml(url)}" alt="${App.escapeHtml(altText)}">`;
  mediaLightbox.classList.remove("hidden");
}

function getDisplayContent(message) {
  if (message?.deleted) {
    return App.t("state_message_deleted");
  }
  return message?.content || "";
}

function formatMessageContent(text) {
  const raw = (text || "").toString();
  if (!raw) {
    return "";
  }
  const urlRegex = /((https?:\/\/|www\.)[^\s<]+[^\s<\.)])/gi;
  let result = "";
  let lastIndex = 0;
  raw.replace(urlRegex, (match, _prefix, _scheme, offset) => {
    result += App.escapeHtml(raw.slice(lastIndex, offset));
    const href = match.startsWith("http") ? match : `https://${match}`;
    result += `<a href="${App.escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${App.escapeHtml(match)}</a>`;
    lastIndex = offset + match.length;
    return match;
  });
  if (lastIndex === 0) {
    result = App.escapeHtml(raw);
  } else {
    result += App.escapeHtml(raw.slice(lastIndex));
  }
  return result.replace(/\n/g, "<br>");
}

function renderReplySnippet(replyTo) {
  if (!replyTo || !replyTo.message_id) {
    return "";
  }
  const label = replyTo.username || App.t("state_system");
  const snippet = buildReplySnippetText(replyTo);
  return `
    <div class="reply-snippet">
      <strong>${App.escapeHtml(label)}</strong>
      <div class="reply-text">${App.escapeHtml(snippet)}</div>
    </div>
  `;
}

function renderMessageActions(message, isOwn) {
  if (!message || message.type !== "message" || !message.message_id || message.deleted) {
    return "";
  }
  const replyButton = `
    <button type="button" class="ghost message-action" data-reply-id="${App.escapeHtml(message.message_id)}">${App.escapeHtml(App.t("button_reply"))}</button>
  `;
  const editButton = isOwn ? `
    <button type="button" class="ghost message-action" data-edit-id="${App.escapeHtml(message.message_id)}">${App.escapeHtml(App.t("button_edit"))}</button>
  ` : "";
  const deleteButton = isOwn ? `
    <button type="button" class="ghost message-action" data-delete-id="${App.escapeHtml(message.message_id)}">${App.escapeHtml(App.t("button_delete"))}</button>
  ` : "";
  return `
    <div class="message-actions">
      ${replyButton}
      ${editButton}
      ${deleteButton}
    </div>
  `;
}

function bindMessageActions(card, message, isOwn) {
  if (!card || !message || message.type !== "message") {
    return;
  }
  card.querySelectorAll("[data-reply-id]").forEach((button) => {
    button.addEventListener("click", () => setReplyDraft(message));
  });
  if (isOwn) {
    card.querySelectorAll("[data-edit-id]").forEach((button) => {
      button.addEventListener("click", () => setEditDraft(message));
    });
    card.querySelectorAll("[data-delete-id]").forEach((button) => {
      button.addEventListener("click", () => requestDeleteMessage(message));
    });
  }
}

function resolveMessageAvatarUrl(message, isOwn) {
  if (message.user_avatar_url) {
    return message.user_avatar_url;
  }
  if (isOwn) {
    return currentUser?.avatar_url || "";
  }
  if (activeChat?.user?.id === message.user_id) {
    return activeChat.user.avatar_url || "";
  }
  const conversation = directConversations.find((item) => item.id === message.user_id);
  return conversation?.avatar_url || "";
}

async function handleSendMessage(event) {
  event.preventDefault();
  const text = messageInput.value.trim();
  if ((!text && !pendingAttachments.length) || !activeChat) {
    return;
  }

  if (editDraft) {
    if (!text) {
      return;
    }
    sendEditMessage(editDraft.message_id, text);
    messageInput.value = "";
    clearAttachment();
    clearComposerDrafts();
    return;
  }

  let attachments = [];
  if (pendingAttachments.length) {
    try {
      attachments = await uploadAttachments(pendingAttachments);
    } catch (error) {
      addSystemMessage(App.t("upload_attachment_failed", { message: error.message }));
      return;
    }
  }

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    queueMessage({ text, attachments, replyTo: replyDraft });
    connectSocket();
    addSystemMessage(App.t("chat_socket_queueing"));
    messageInput.value = "";
    clearAttachment();
    clearComposerDrafts();
    return;
  }

  sendChatMessage(text, attachments, replyDraft);
  messageInput.value = "";
  clearAttachment();
  clearComposerDrafts();
}

function addSystemMessage(content) {
  appendMessage({
    type: "system",
    user_id: "system",
    username: App.t("state_system"),
    content,
    created_at: new Date().toISOString(),
  });
}

function getMessageKey(message) {
  if (!message) {
    return "";
  }
  return [
    activeChat?.id || "",
    message.type || "",
    message.user_id || "",
    message.message_id || "",
    message.content || "",
    message.client_message_id || message.created_at || "",
  ].join("|");
}

function reconcilePendingOwnMessage(message) {
  if (!message || message.type !== "message" || message.user_id !== currentUser?.id || !message.client_message_id) {
    return false;
  }

  if (!pendingOwnMessages.has(message.client_message_id)) {
    return false;
  }

  pendingOwnMessages.delete(message.client_message_id);

  const existingCard = messagesContainer.querySelector(`[data-client-message-id="${message.client_message_id}"]`);
  if (!existingCard) {
    return false;
  }

  existingCard.querySelector(".message-meta span:last-child").textContent = App.formatTime(message.created_at);
  const existingText = existingCard.querySelector(".message-text");
  if (message.content) {
    const html = formatMessageContent(message.content);
    if (existingText) {
      existingText.innerHTML = html;
    } else {
      const textNode = document.createElement("div");
      textNode.className = "message-text";
      textNode.innerHTML = html;
      const contentNode = existingCard.querySelector(".message-content") || existingCard;
      const attachmentNode = contentNode.querySelector(".message-attachment");
      if (attachmentNode) {
        contentNode.insertBefore(textNode, attachmentNode);
      } else {
        contentNode.appendChild(textNode);
      }
    }
  } else if (existingText) {
    existingText.remove();
  }
  if (message.message_id) {
    existingCard.dataset.messageId = message.message_id;
    const actionsNode = existingCard.querySelector(".message-actions");
    if (!actionsNode && message.type === "message") {
      const contentNode = existingCard.querySelector(".message-content");
      if (contentNode) {
        contentNode.insertAdjacentHTML("beforeend", renderMessageActions(message, true));
        bindMessageActions(existingCard, message, true);
      }
    }
  }
  renderedMessageKeys.add(getMessageKey(message));
  return true;
}

function createClientMessageId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function queueMessage(content) {
  queuedMessages.push(content);
}

function flushQueuedMessages() {
  while (queuedMessages.length && socket && socket.readyState === WebSocket.OPEN) {
    const queued = queuedMessages.shift();
    sendChatMessage(queued.text, queued.attachments || [], queued.replyTo || null);
  }
}

function sendChatMessage(text, attachments = [], replyTo = null) {
  const clientMessageId = createClientMessageId();
  const optimisticMessage = {
    type: "message",
    user_id: currentUser.id,
    username: currentUser.username,
    user_avatar_url: currentUser.avatar_url || "",
    content: text,
    created_at: new Date().toISOString(),
    client_message_id: clientMessageId,
  };
  if (replyTo?.message_id) {
    optimisticMessage.reply_to = replyTo;
  }
  if (attachments.length) {
    optimisticMessage.attachments = attachments;
  }
  appendMessage(optimisticMessage);
  pendingOwnMessages.set(clientMessageId, optimisticMessage);
  try {
    socket.send(JSON.stringify({
      content: text,
      client_message_id: clientMessageId,
      attachments,
      reply_to: replyTo?.message_id || "",
    }));
    if (activeChat) {
      activeChat.unreadCount = 0;
    }
    refreshConversationPreview(optimisticMessage, 0);
  } catch (error) {
    pendingOwnMessages.delete(clientMessageId);
    addSystemMessage(App.t("chat_send_failed", { message: error.message }));
  }
}

function requestDeleteMessage(message) {
  if (!message?.message_id) {
    return;
  }
  const confirmed = window.confirm(App.t("button_delete") + "?");
  if (!confirmed) {
    return;
  }
  sendDeleteMessage(message.message_id);
  clearComposerDrafts();
}

function sendEditMessage(messageId, content) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addSystemMessage(App.t("helper_transport_failed"));
    return;
  }
  try {
    socket.send(JSON.stringify({
      action: "edit",
      message_id: messageId,
      content,
    }));
  } catch (error) {
    addSystemMessage(App.t("chat_send_failed", { message: error.message }));
  }
}

function sendDeleteMessage(messageId) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    addSystemMessage(App.t("helper_transport_failed"));
    return;
  }
  try {
    socket.send(JSON.stringify({
      action: "delete",
      message_id: messageId,
    }));
  } catch (error) {
    addSystemMessage(App.t("chat_send_failed", { message: error.message }));
  }
}

function handleIncomingConversationMessage(message) {
  if (message?.type === "message_edit") {
    applyMessageEdit(message);
    refreshConversationPreviewAfterUpdate(message);
    return;
  }
  if (message?.type === "message_delete") {
    applyMessageDelete(message);
    refreshConversationPreviewAfterUpdate(message);
    return;
  }
  appendMessage(message);
  if (activeChat) {
    activeChat.messages.push(message);
  }

  const isOwnMessage = message.type === "message" && message.user_id === currentUser.id;
  const shouldMarkReadNow = !isOwnMessage && canMarkActiveChatRead();
  let unreadCount = Number(activeChat?.unreadCount || 0);

  if (message.type === "message") {
    if (isOwnMessage || shouldMarkReadNow) {
      unreadCount = 0;
    } else {
      unreadCount += 1;
      showDirectMessageNotification(message);
    }
  }

  if (activeChat) {
    activeChat.unreadCount = unreadCount;
  }
  refreshConversationPreview(message, unreadCount);

  if (shouldMarkReadNow) {
    void syncActiveConversationReadState();
  } else {
    updateUnreadIndicators();
  }
}

function applyMessageEdit(update) {
  if (!activeChat?.messages || !update?.message_id) {
    return;
  }
  const index = activeChat.messages.findIndex((item) => item.message_id === update.message_id);
  if (index < 0) {
    return;
  }
  const updated = {
    ...activeChat.messages[index],
    content: update.content ?? "",
    edited_at: update.edited_at || new Date().toISOString(),
    deleted: false,
  };
  activeChat.messages[index] = updated;
  updateMessageCard(updated);
}

function applyMessageDelete(update) {
  if (!activeChat?.messages || !update?.message_id) {
    return;
  }
  const index = activeChat.messages.findIndex((item) => item.message_id === update.message_id);
  if (index < 0) {
    return;
  }
  const updated = {
    ...activeChat.messages[index],
    content: "",
    attachment: null,
    edited_at: update.edited_at || new Date().toISOString(),
    deleted: true,
  };
  activeChat.messages[index] = updated;
  updateMessageCard(updated);
}

function updateMessageCard(message) {
  const card = messagesContainer.querySelector(`[data-message-id="${message.message_id}"]`);
  if (!card) {
    return;
  }
  const displayContent = getDisplayContent(message);
  const textElement = card.querySelector(".message-text");
  if (displayContent) {
    const html = formatMessageContent(displayContent);
    if (textElement) {
      textElement.innerHTML = html;
    } else {
      const textNode = document.createElement("div");
      textNode.className = "message-text";
      textNode.innerHTML = html;
      const contentNode = card.querySelector(".message-content") || card;
      const attachmentNode = contentNode.querySelector(".message-attachment");
      if (attachmentNode) {
        contentNode.insertBefore(textNode, attachmentNode);
      } else {
        contentNode.appendChild(textNode);
      }
    }
  } else if (textElement) {
    textElement.remove();
  }

  const attachmentNodes = card.querySelectorAll(".message-attachment");
  if (message.deleted || (!getMessageAttachments(message).length && attachmentNodes.length)) {
    attachmentNodes.forEach((node) => node.remove());
    if (message.deleted) {
      const actionsNode = card.querySelector(".message-actions");
      actionsNode?.remove();
    }
  }

  const metaRight = card.querySelector(".message-meta-right");
  if (metaRight) {
    const edited = metaRight.querySelector(".message-edited");
    if (message.edited_at) {
      if (!edited) {
        const span = document.createElement("span");
        span.className = "message-edited";
        span.textContent = App.t("state_message_edited");
        metaRight.appendChild(span);
      }
    } else if (edited) {
      edited.remove();
    }
  }
}

function refreshConversationPreviewAfterUpdate(update) {
  if (!activeChat) {
    return;
  }
  const conversation = directConversations.find((item) => item.id === activeChat.user.id);
  if (!conversation || !conversation.last_message) {
    return;
  }
  if (conversation.last_message.message_id !== update.message_id) {
    return;
  }
  if (update.type === "message_delete") {
    conversation.last_message = {
      ...conversation.last_message,
      content: "",
      attachment: null,
      edited_at: update.edited_at || conversation.last_message.edited_at,
      deleted: true,
    };
  } else if (update.type === "message_remove_attachments") {
    conversation.last_message = {
      ...conversation.last_message,
      attachment: null,
      attachments: null,
      edited_at: update.edited_at || conversation.last_message.edited_at,
    };
  } else {
    conversation.last_message = {
      ...conversation.last_message,
      content: update.content ?? "",
      edited_at: update.edited_at || conversation.last_message.edited_at,
      deleted: false,
    };
  }
  renderDirectConversations();
  updateUnreadIndicators();
}

function refreshConversationPreview(message, unreadCount = null) {
  if (!activeChat) {
    return;
  }
  const conversationIndex = directConversations.findIndex((item) => item.id === activeChat.user.id);
  const conversation = conversationIndex >= 0 ? directConversations[conversationIndex] : null;
  if (conversation) {
    conversation.last_message = message;
    conversation.message_count = (conversation.message_count || 0) + 1;
    if (unreadCount !== null) {
      conversation.unread_count = unreadCount;
    }
    directConversations.splice(conversationIndex, 1);
    directConversations.unshift(conversation);
  } else {
    directConversations.unshift({
      id: activeChat.user.id,
      username: activeChat.user.username,
      avatar_url: activeChat.user.avatar_url || "",
      last_message: message,
      message_count: 1,
      unread_count: unreadCount || 0,
    });
  }
  renderDirectConversations();
  updateUnreadIndicators();
}

function canMarkActiveChatRead() {
  return Boolean(activeChat) && document.visibilityState === "visible" && document.hasFocus();
}

async function syncActiveConversationReadState() {
  if (!activeChat || !canMarkActiveChatRead()) {
    return;
  }
  try {
    await App.apiFetch(`/dms/${activeChat.user.id}/read`, { method: "POST" });
  } catch {
    return;
  }
  activeChat.unreadCount = 0;
  const conversation = directConversations.find((item) => item.id === activeChat.user.id);
  if (conversation) {
    conversation.unread_count = 0;
  }
  renderDirectConversations();
  updateUnreadIndicators();
}

function updateUnreadIndicators() {
  const totalUnread = directConversations.reduce((total, conversation) => total + Number(conversation.unread_count || 0), 0);
  App.setDocumentTitle(totalUnread);
}

function showDirectMessageNotification(message) {
  if (document.visibilityState === "visible" && document.hasFocus()) {
    return;
  }
  const attachments = getMessageAttachments(message);
  const body = (message.content || "").trim()
    || attachments[0]?.name
    || App.t("state_attachment_file");
  App.rememberDirectMessageActivity(activeChat?.user?.id || message.user_id, message.created_at);
  App.notify({
    title: message.username || activeChat?.user?.username || App.t("state_active_direct"),
    body,
    tag: `dm:${activeChat?.user?.id || message.user_id || "message"}`,
    icon: resolveMessageAvatarUrl(message, false) || currentUser?.avatar_url || "",
    href: "/dms",
  });
  void App.playNotificationSound();
}

function refreshSocketLabels() {
  if (!activeChat) {
    if (socketEndpointDisplay) {
      socketEndpointDisplay.textContent = App.getDefaultSocketEndpoint();
    }
    setSocketStatus(App.t("state_socket_offline"));
    setTransportHint(App.t("helper_transport_fixed"));
    updateConnectionActionButton();
    return;
  }
  if (socketEndpointDisplay) {
    socketEndpointDisplay.textContent = buildSocketUrl().replace(/\?.*$/, "");
  }
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    setSocketStatus(App.t("state_socket_offline"));
    setTransportHint(manuallyDisconnected ? App.t("helper_transport_disconnected") : App.t("helper_transport_connecting"));
    updateConnectionActionButton();
    return;
  }
  if (socket.readyState === WebSocket.CONNECTING) {
    setSocketStatus(App.t("state_socket_connecting"));
    setTransportHint(App.t("helper_transport_connecting"));
    updateConnectionActionButton();
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    setSocketStatus(App.t("state_socket_online"));
    setTransportHint(App.t("helper_transport_connected"));
    updateConnectionActionButton();
    return;
  }
  setSocketStatus(App.t("state_socket_error"));
  setTransportHint(App.t("helper_transport_failed"));
  updateConnectionActionButton();
}

function updateAttachmentState() {
  if (!attachmentList) {
    return;
  }
  if (isUploadingAttachments) {
    const attachmentNames = pendingAttachments.map((file) => `
      <div class="attachment-chip">
        <span class="chip-name">${App.escapeHtml(file.name)}</span>
      </div>
    `).join("");
    attachmentList.innerHTML = `
      <div class="attachment-chip uploading">
        <span class="chip-name">${App.escapeHtml(App.t("state_uploading_attachments"))}</span>
      </div>
      ${attachmentNames}
    `;
    attachmentList.classList.remove("hidden");
    updateRecordingButton();
    return;
  }
  if (isRecording) {
    attachmentList.innerHTML = `
      <div class="attachment-chip recording">
        <span class="chip-name">${App.escapeHtml(App.t("state_recording_voice"))}</span>
      </div>
    `;
    attachmentList.classList.remove("hidden");
    updateRecordingButton();
    return;
  }
  if (!pendingAttachments.length) {
    attachmentList.innerHTML = "";
    attachmentList.classList.add("hidden");
    updateRecordingButton();
    return;
  }

  attachmentList.innerHTML = pendingAttachments.map((file, index) => `
    <div class="attachment-chip">
      <span class="chip-name">${App.escapeHtml(file.name)}</span>
      <button type="button" class="chip-remove" data-remove-attachment="${index}" aria-label="Remove">x</button>
    </div>
  `).join("");
  attachmentList.classList.remove("hidden");
  updateRecordingButton();

  attachmentList.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeAttachment);
      if (Number.isNaN(index)) {
        return;
      }
      pendingAttachments.splice(index, 1);
      if (!pendingAttachments.length) {
        attachmentInput.value = "";
      }
      updateAttachmentState();
    });
  });
}

function handleSelectedAttachment(files) {
  if (!files || !files.length) {
    return;
  }
  const merged = pendingAttachments.concat(Array.from(files));
  pendingAttachments = merged.slice(0, MAX_ATTACHMENTS);
  if (merged.length > MAX_ATTACHMENTS) {
    addSystemMessage(App.t("attachment_limit_reached"));
  }
  updateAttachmentState();
}

function handlePasteAttachment(event) {
  if (!event.clipboardData?.items?.length) {
    return;
  }
  if (isRecording) {
    return;
  }
  if (pendingAttachments.length >= MAX_ATTACHMENTS) {
    addSystemMessage(App.t("attachment_limit_reached"));
    return;
  }

  const items = Array.from(event.clipboardData.items);
  const fileItem = items.find((item) => item.kind === "file");
  if (!fileItem) {
    return;
  }
  const file = fileItem.getAsFile();
  if (!file) {
    return;
  }
  event.preventDefault();
  pendingAttachments = pendingAttachments.concat([file]).slice(0, MAX_ATTACHMENTS);
  updateAttachmentState();
}

function clearAttachment() {
  pendingAttachments = [];
  attachmentInput.value = "";
  updateAttachmentState();
}

async function toggleVoiceRecording() {
  if (isRecording) {
    stopVoiceRecording();
    return;
  }
  try {
    await startVoiceRecording();
  } catch (error) {
    const message = error?.message || App.t("recording_not_supported");
    addSystemMessage(message);
    resetRecordingState();
  }
}

async function startVoiceRecording() {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error(App.t("recording_not_supported"));
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch((error) => {
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      throw new Error(App.t("recording_permission_denied"));
    }
    throw new Error(App.t("recording_failed", { message: error.message || error.name || "unknown" }));
  });

  const mimeType = getRecordingMimeType();
  mediaRecorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  recordingStream = stream;
  recordingChunks = [];
  isRecording = true;
  pendingAttachments = [];
  attachmentInput.value = "";
  updateAttachmentState();

  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      recordingChunks.push(event.data);
    }
  });
  mediaRecorder.addEventListener("stop", finalizeVoiceRecording);
  mediaRecorder.addEventListener("error", (event) => {
    addSystemMessage(App.t("recording_failed", { message: event.error?.message || "unknown" }));
    resetRecordingState();
  });
  mediaRecorder.start();
}

function stopVoiceRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
}

function finalizeVoiceRecording() {
  const mimeType = mediaRecorder?.mimeType || getRecordingMimeType() || "audio/webm";
  const chunks = recordingChunks.slice();
  resetRecordingState();
  if (!chunks.length) {
    return;
  }
  const extension = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm";
  if (pendingAttachments.length >= MAX_ATTACHMENTS) {
    addSystemMessage(App.t("attachment_limit_reached"));
    updateAttachmentState();
    return;
  }
  pendingAttachments = pendingAttachments.concat([new File(chunks, `voice-${Date.now()}.${extension}`, { type: mimeType })]).slice(0, MAX_ATTACHMENTS);
  updateAttachmentState();
}

function resetRecordingState() {
  isRecording = false;
  if (recordingStream) {
    recordingStream.getTracks().forEach((track) => track.stop());
  }
  recordingStream = null;
  mediaRecorder = null;
  recordingChunks = [];
  updateRecordingButton();
  updateAttachmentState();
}

function updateRecordingButton() {
  if (!audioButton) {
    return;
  }
  const label = isRecording ? App.t("button_stop_recording") : App.t("button_audio");
  audioButton.setAttribute("aria-label", label);
  audioButton.setAttribute("title", label);
  const srLabel = audioButton.querySelector(".sr-only");
  if (srLabel) {
    srLabel.textContent = label;
  }
  audioButton.classList.toggle("is-recording", isRecording);
}

function getRecordingMimeType() {
  const candidates = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/mp4"];
  return candidates.find((value) => window.MediaRecorder?.isTypeSupported?.(value)) || "";
}

async function uploadAttachment(file) {
  const formData = new FormData();
  formData.append("file", file);
  const payload = await App.apiFetch("/uploads", { method: "POST", body: formData });
  return payload.attachment;
}

async function uploadAttachments(files) {
  if (!files.length) {
    return [];
  }
  isUploadingAttachments = true;
  updateAttachmentState();
  const results = [];
  try {
    for (const file of files) {
      const attachment = await uploadAttachment(file);
      results.push(attachment);
    }
  } finally {
    isUploadingAttachments = false;
    updateAttachmentState();
  }
  return results;
}

function getMessageAttachments(message) {
  if (Array.isArray(message?.attachments)) {
    return message.attachments;
  }
  if (message?.attachment) {
    return [message.attachment];
  }
  return [];
}

function renderAttachment(message) {
  const attachments = getMessageAttachments(message);
  if (message?.deleted || !attachments.length) {
    return "";
  }
  const html = attachments.map((attachment) => {
    if (!attachment?.url) {
      return "";
    }
    if (attachment.kind === "image") {
      return `
        <div class="message-attachment">
          <img data-open-image="1" data-image-url="${App.escapeHtml(attachment.url)}" src="${App.escapeHtml(attachment.url)}" alt="${App.escapeHtml(attachment.name || App.t("state_attachment_image"))}">
        </div>
      `;
    }
    if (attachment.kind === "audio") {
      return `
        <div class="message-attachment">
          <audio controls preload="metadata" src="${App.escapeHtml(attachment.url)}"></audio>
        </div>
      `;
    }
    if (attachment.content_type?.startsWith?.("video/")) {
      return `
        <div class="message-attachment">
          <video controls preload="metadata" src="${App.escapeHtml(attachment.url)}"></video>
        </div>
      `;
    }
    return `
      <div class="message-attachment">
        <a href="${App.escapeHtml(attachment.url)}" download="${App.escapeHtml(attachment.name || "attachment")}" target="_blank" rel="noopener noreferrer">${App.escapeHtml(attachment.name || App.t("state_attachment_file"))}</a>
        <span class="small-text">${App.escapeHtml(App.formatFileSize(attachment.size || 0))}</span>
      </div>
    `;
  }).join("");
  return html;
}

function bindMediaPreview(card, message) {
  if (!card) {
    return;
  }
  const images = card.querySelectorAll("[data-open-image]");
  images.forEach((image) => {
    const url = image.dataset.imageUrl || "";
    image.addEventListener("click", () => {
      if (!url) {
        return;
      }
      const altText = image.getAttribute("alt") || "";
      openImageLightbox(url, altText);
    });
  });
}
