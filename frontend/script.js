const authForm = document.getElementById("authForm");
const authUsernameInput = document.getElementById("authUsernameInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authSubmitButton = document.getElementById("authSubmitButton");
const authStatus = document.getElementById("authStatus");
const showLoginButton = document.getElementById("showLoginButton");
const showRegisterButton = document.getElementById("showRegisterButton");
const accountTitle = document.getElementById("accountTitle");
const accountSummary = document.getElementById("accountSummary");
const accountUsername = document.getElementById("accountUsername");
const logoutButton = document.getElementById("logoutButton");

const secretInput = document.getElementById("secretInput");
const serverInput = document.getElementById("serverInput");
const createServerForm = document.getElementById("createServerForm");
const serverNameInput = document.getElementById("serverNameInput");
const joinedServers = document.getElementById("joinedServers");
const discoverServers = document.getElementById("discoverServers");

const activeServerName = document.getElementById("activeServerName");
const memberCountChip = document.getElementById("memberCountChip");
const socketStatusChip = document.getElementById("socketStatusChip");
const membersList = document.getElementById("membersList");
const messagesContainer = document.getElementById("messages");
const composerForm = document.getElementById("composerForm");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");

const themeToggle = document.getElementById("themeToggle");
const themeToggleLabel = document.getElementById("themeToggleLabel");

const API_BASE = "/api";
const THEME_STORAGE_KEY = "cipherline-theme";
const SESSION_STORAGE_KEY = "cipherline-session-token";
const ACTIVE_SERVER_STORAGE_KEY = "cipherline-active-server";

const DEFAULT_NOISE_SYMBOL = "#";
const DEFAULT_NOISE_INTERVAL = 4;
const LEGACY_FAKE_SYMBOLS = new Set(["#", "@", "%", "&", "*", "!"]);

let authMode = "login";
let authToken = localStorage.getItem(SESSION_STORAGE_KEY) || "";
let currentUser = null;
let socket = null;
let activeServer = null;
let joinedServerRecords = [];
let discoverServerRecords = [];

initializeTheme();
initializeDefaults();
registerEvents();
bootstrapSession();

function initializeDefaults() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = window.location.hostname || "127.0.0.1";
  const isLocalhost = ["127.0.0.1", "localhost"].includes(hostname);
  const defaultHost = isLocalhost ? `${hostname}:8000` : window.location.host;
  const host = window.location.host && !isLocalhost ? window.location.host : defaultHost;
  serverInput.value = `${protocol}//${host}/ws`;
}

function registerEvents() {
  authForm.addEventListener("submit", handleAuthSubmit);
  showLoginButton.addEventListener("click", () => setAuthMode("login"));
  showRegisterButton.addEventListener("click", () => setAuthMode("register"));
  logoutButton.addEventListener("click", handleLogout);
  createServerForm.addEventListener("submit", handleCreateServer);
  composerForm.addEventListener("submit", handleSendMessage);
  themeToggle.addEventListener("click", toggleTheme);
  secretInput.addEventListener("change", reconnectActiveServer);
  serverInput.addEventListener("change", reconnectActiveServer);
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composerForm.requestSubmit();
    }
  });
}

async function bootstrapSession() {
  setAuthMode("login");
  renderJoinedServers();
  renderDiscoverServers();
  renderMembers([]);
  addEmptyChatState("Log in to access servers and messages.");

  if (!authToken) {
    return;
  }

  try {
    const session = await apiFetch("/session");
    currentUser = session.user;
    applyAuthenticatedState();
    await refreshServers();
    const rememberedServerId = localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY);
    if (rememberedServerId) {
      await openServer(rememberedServerId);
    }
  } catch {
    clearSession();
  }
}

function setAuthMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  accountTitle.textContent = isLogin ? "Sign in" : "Create account";
  authSubmitButton.textContent = isLogin ? "Login" : "Register";
  showLoginButton.classList.toggle("active", isLogin);
  showRegisterButton.classList.toggle("active", !isLogin);
}

async function handleAuthSubmit(event) {
  event.preventDefault();

  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value;

  if (!username || !password) {
    setAuthStatus("Username and password are required.", true);
    return;
  }

  try {
    const payload = await apiFetch(`/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }, false);

    authToken = payload.token;
    currentUser = payload.user;
    localStorage.setItem(SESSION_STORAGE_KEY, authToken);
    authPasswordInput.value = "";
    applyAuthenticatedState();
    await refreshServers();
    setAuthStatus(authMode === "login" ? "Login successful." : "Account created.");
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

function applyAuthenticatedState() {
  accountSummary.classList.remove("hidden");
  logoutButton.classList.remove("hidden");
  authForm.classList.add("hidden");
  document.getElementById("authTabs").classList.add("hidden");
  accountUsername.textContent = currentUser.username;
  authStatus.textContent = `Authenticated. Create a server or join one below.`;
}

function handleLogout() {
  disconnectSocket();
  clearSession();
  currentUser = null;
  activeServer = null;
  joinedServerRecords = [];
  discoverServerRecords = [];
  authForm.classList.remove("hidden");
  document.getElementById("authTabs").classList.remove("hidden");
  accountSummary.classList.add("hidden");
  logoutButton.classList.add("hidden");
  setAuthMode("login");
  authStatus.textContent = "Create an account or log in to access your servers.";
  renderJoinedServers();
  renderDiscoverServers();
  renderMembers([]);
  resetActiveServerState();
  addEmptyChatState("Log in to access servers and messages.");
}

function clearSession() {
  authToken = "";
  localStorage.removeItem(SESSION_STORAGE_KEY);
  localStorage.removeItem(ACTIVE_SERVER_STORAGE_KEY);
}

function setAuthStatus(message, isError = false) {
  authStatus.textContent = message;
  authStatus.style.color = isError ? "var(--danger)" : "var(--muted)";
}

async function refreshServers() {
  if (!authToken) {
    return;
  }

  const [joinedPayload, discoverPayload] = await Promise.all([
    apiFetch("/servers"),
    apiFetch("/servers/discover"),
  ]);

  joinedServerRecords = joinedPayload.servers;
  discoverServerRecords = discoverPayload.servers;
  renderJoinedServers();
  renderDiscoverServers();
}

async function handleCreateServer(event) {
  event.preventDefault();
  if (!authToken) {
    setAuthStatus("You must be logged in to create a server.", true);
    return;
  }

  const name = serverNameInput.value.trim();
  if (!name) {
    return;
  }

  try {
    const payload = await apiFetch("/servers", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    serverNameInput.value = "";
    await refreshServers();
    await openServer(payload.server.id);
  } catch (error) {
    setAuthStatus(error.message, true);
  }
}

function renderJoinedServers() {
  joinedServers.innerHTML = "";

  if (!joinedServerRecords.length) {
    joinedServers.innerHTML = `<div class="empty-state">No joined servers yet.</div>`;
    return;
  }

  joinedServerRecords.forEach((server) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `server-item ${activeServer?.id === server.id ? "active" : ""}`;
    item.innerHTML = `
      <div class="server-name">${escapeHtml(server.name)}</div>
      <div class="server-meta">${server.member_count} members</div>
    `;
    item.addEventListener("click", () => openServer(server.id));
    joinedServers.appendChild(item);
  });
}

function renderDiscoverServers() {
  discoverServers.innerHTML = "";

  if (!discoverServerRecords.length) {
    discoverServers.innerHTML = `<div class="empty-state">No servers available yet.</div>`;
    return;
  }

  discoverServerRecords.forEach((server) => {
    const wrapper = document.createElement("div");
    wrapper.className = "server-item";
    wrapper.innerHTML = `
      <div class="server-name">${escapeHtml(server.name)}</div>
      <div class="server-meta">${server.member_count} members</div>
    `;

    if (!server.joined) {
      const joinButton = document.createElement("button");
      joinButton.type = "button";
      joinButton.className = "join-button";
      joinButton.textContent = "Join server";
      joinButton.addEventListener("click", async () => {
        await apiFetch(`/servers/${server.id}/join`, { method: "POST" });
        await refreshServers();
        await openServer(server.id);
      });
      wrapper.appendChild(joinButton);
    }

    discoverServers.appendChild(wrapper);
  });
}

async function openServer(serverId) {
  if (!authToken) {
    return;
  }

  try {
    const payload = await apiFetch(`/servers/${serverId}`);
    activeServer = payload.server;
    localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, serverId);
    renderJoinedServers();
    renderMembers(activeServer.members);
    renderHistory(activeServer.messages);
    activeServerName.textContent = activeServer.name;
    memberCountChip.textContent = `${activeServer.member_count} members`;
    await connectSocket();
  } catch (error) {
    addSystemMessage(error.message);
  }
}

function renderMembers(members) {
  membersList.innerHTML = "";
  if (!members.length) {
    membersList.innerHTML = `<div class="empty-state">No members loaded.</div>`;
    return;
  }

  members.forEach((member) => {
    const item = document.createElement("div");
    const isOwner = activeServer && member.id === activeServer.owner_id;
    item.className = `member-item ${isOwner ? "owner" : ""}`;
    item.innerHTML = `${escapeHtml(member.username)}<span class="member-role">${isOwner ? "Owner" : "Member"}</span>`;
    membersList.appendChild(item);
  });
}

function renderHistory(messages) {
  messagesContainer.innerHTML = "";
  if (!messages.length) {
    addEmptyChatState("No messages yet in this server.");
    return;
  }

  messages.forEach((message) => appendMessage(message, false));
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function addEmptyChatState(text) {
  messagesContainer.innerHTML = `<div class="empty-state">${escapeHtml(text)}</div>`;
}

async function connectSocket() {
  disconnectSocket(false);

  if (!activeServer) {
    return;
  }

  const secret = secretInput.value;
  if (!secret) {
    setSocketStatus("Offline", true);
    addSystemMessage("Enter the shared transport key to connect to live updates.");
    return;
  }

  const baseUrl = serverInput.value.trim().replace(/\/+$/, "");
  if (!baseUrl) {
    addSystemMessage("WebSocket endpoint is required.");
    return;
  }

  try {
    socket = new WebSocket(`${baseUrl}/${encodeURIComponent(activeServer.id)}?token=${encodeURIComponent(authToken)}`);
  } catch (error) {
    addSystemMessage(`Unable to open socket: ${error.message}`);
    return;
  }

  setSocketStatus("Connecting");

  socket.addEventListener("open", () => {
    setSocketStatus("Online");
    messageInput.disabled = false;
    sendButton.disabled = false;
    messageInput.focus();
  });

  socket.addEventListener("message", (event) => {
    try {
      const decrypted = decryptMessage(event.data, secret);
      const message = JSON.parse(decrypted);
      appendMessage(message, true);
    } catch (error) {
      addSystemMessage(`Unable to decode live message. ${error.message}`);
    }
  });

  socket.addEventListener("close", () => {
    setSocketStatus("Offline", true);
    messageInput.disabled = true;
    sendButton.disabled = true;
    socket = null;
  });

  socket.addEventListener("error", () => {
    setSocketStatus("Error", true);
    addSystemMessage("WebSocket error. Check the endpoint and the shared transport key.");
  });
}

function disconnectSocket(resetComposer = true) {
  if (socket) {
    socket.close();
    socket = null;
  }
  if (resetComposer) {
    messageInput.disabled = true;
    sendButton.disabled = true;
  }
  setSocketStatus("Offline", true);
}

function reconnectActiveServer() {
  if (activeServer) {
    connectSocket();
  }
}

async function handleSendMessage(event) {
  event.preventDefault();

  const text = messageInput.value.trim();
  const secret = secretInput.value;
  if (!text || !secret || !socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  try {
    socket.send(encryptMessage(text, secret));
    messageInput.value = "";
    messageInput.focus();
  } catch (error) {
    addSystemMessage(`Unable to encrypt message. ${error.message}`);
  }
}

function appendMessage(message, scroll = true) {
  const isOwnMessage = currentUser && message.user_id === currentUser.id && message.type === "message";
  const variant = message.type === "system" ? "system" : isOwnMessage ? "self" : "remote";

  const empty = messagesContainer.querySelector(".empty-state");
  if (empty) {
    empty.remove();
  }

  const card = document.createElement("article");
  card.className = `message-card ${variant}`;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const label = document.createElement("span");
  label.textContent = message.type === "system" ? "System" : isOwnMessage ? "You" : message.username;
  const time = document.createElement("span");
  time.textContent = formatTime(message.created_at);
  meta.append(label, time);

  const body = document.createElement("p");
  body.className = "message-text";
  body.textContent = message.content;

  card.append(meta, body);
  messagesContainer.appendChild(card);

  if (scroll) {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

function addSystemMessage(text) {
  appendMessage({ type: "system", user_id: "system", username: "System", content: text, created_at: new Date().toISOString() });
}

function resetActiveServerState() {
  activeServerName.textContent = "No server selected";
  memberCountChip.textContent = "0 members";
  renderMembers([]);
  messageInput.disabled = true;
  sendButton.disabled = true;
}

function setSocketStatus(text, subtle = false) {
  socketStatusChip.textContent = text;
  socketStatusChip.classList.toggle("subtle", subtle || text !== "Online");
}

async function apiFetch(path, options = {}, includeAuth = true) {
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body) {
    headers.set("Content-Type", "application/json");
  }
  if (includeAuth && authToken) {
    headers.set("Authorization", `Bearer ${authToken}`);
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.detail || "Request failed.");
  }
  return payload;
}

function formatTime(value) {
  if (!value) {
    return "now";
  }
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function initializeTheme() {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  applyTheme(storedTheme || "dark");
}

function toggleTheme() {
  const currentTheme = document.documentElement.dataset.theme || "light";
  const nextTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
}

function applyTheme(theme) {
  const normalizedTheme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = normalizedTheme;
  const isDark = normalizedTheme === "dark";
  themeToggleLabel.textContent = isDark ? "Light mode" : "Dark mode";
  document.querySelector(".theme-toggle__icon").textContent = isDark ? "L" : "D";
}

function validateNoiseSymbol(noiseSymbol) {
  if (!noiseSymbol || noiseSymbol.length !== 1) {
    throw new Error("The noise symbol must be a single character.");
  }
  if (noiseSymbol === "\0") {
    throw new Error("The noise symbol cannot be the null character.");
  }
}

function xorBytes(data, key) {
  if (!key) {
    throw new Error("The key cannot be empty.");
  }

  const keyBytes = new TextEncoder().encode(key);
  const result = new Uint8Array(data.length);
  for (let index = 0; index < data.length; index += 1) {
    result[index] = data[index] ^ keyBytes[index % keyBytes.length];
  }
  return result;
}

function bytesToBase64(bytes) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(base64Text) {
  const binary = atob(base64Text);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

function textToBase64WithXor(text, key) {
  const encrypted = xorBytes(new TextEncoder().encode(text), key);
  return bytesToBase64(encrypted);
}

function base64ToTextWithXor(base64Text, key) {
  let encryptedData;
  try {
    encryptedData = base64ToBytes(base64Text);
  } catch (error) {
    throw new Error(`Invalid Base64 payload: ${error.message}`);
  }

  try {
    return new TextDecoder().decode(xorBytes(encryptedData, key));
  } catch {
    throw new Error("Failed to decode the text. The key may be incorrect or the data may be corrupted.");
  }
}

function create3xNGrid(text) {
  const rows = 3;
  const columns = text ? Math.ceil(text.length / rows) : 1;
  const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ""));
  let index = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (index < text.length) {
        grid[row][column] = text[index];
        index += 1;
      } else {
        grid[row][column] = "\0";
      }
    }
  }

  return { grid, rows, columns };
}

function readGridDiagonally(grid, rows, columns, realLength = null) {
  const result = [];
  for (let diagonalSum = 0; diagonalSum < rows + columns - 1; diagonalSum += 1) {
    for (let row = 0; row < rows; row += 1) {
      const column = diagonalSum - row;
      if (column >= 0 && column < columns) {
        if (realLength !== null && (row * columns + column) >= realLength) {
          continue;
        }
        result.push(grid[row][column]);
      }
    }
  }
  return result.join("");
}

function rebuildGridFromDiagonal(diagonalText, rows, columns, realLength = null) {
  const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => (realLength !== null ? "\0" : "")));
  let index = 0;

  for (let diagonalSum = 0; diagonalSum < rows + columns - 1; diagonalSum += 1) {
    for (let row = 0; row < rows; row += 1) {
      const column = diagonalSum - row;
      if (column >= 0 && column < columns) {
        if (realLength !== null && (row * columns + column) >= realLength) {
          continue;
        }
        if (index < diagonalText.length) {
          grid[row][column] = diagonalText[index];
          index += 1;
        }
      }
    }
  }

  return grid;
}

function readGridByRows(grid, rows, columns) {
  const result = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result.push(grid[row][column]);
    }
  }
  return result.join("");
}

function insertNoiseSymbols(text, interval = DEFAULT_NOISE_INTERVAL, noiseSymbol = DEFAULT_NOISE_SYMBOL) {
  validateNoiseSymbol(noiseSymbol);
  if (interval <= 0) {
    throw new Error("The interval must be greater than zero.");
  }

  let counter = 0;
  const result = [];
  for (const char of text) {
    result.push(char);
    counter += 1;
    if (counter === interval) {
      result.push(noiseSymbol);
      counter = 0;
    }
  }
  return result.join("");
}

function removeLegacyNoiseSymbols(text) {
  return [...text].filter((char) => !LEGACY_FAKE_SYMBOLS.has(char)).join("");
}

function removeNoiseByInterval(text, interval, noiseSymbol) {
  if (interval <= 0) {
    throw new Error("Invalid interval in header. It must be greater than zero.");
  }
  validateNoiseSymbol(noiseSymbol);

  const result = [];
  let counter = 0;
  for (const char of text) {
    if (counter === interval) {
      if (char !== noiseSymbol) {
        throw new Error("Invalid encoded text: noise is not in the expected pattern for the configured symbol.");
      }
      counter = 0;
      continue;
    }
    result.push(char);
    counter += 1;
  }

  if (counter === interval) {
    throw new Error("Invalid encoded text: missing trailing noise marker.");
  }
  return result.join("");
}

function encodeMessage(text, key, noiseSymbol = DEFAULT_NOISE_SYMBOL, interval = DEFAULT_NOISE_INTERVAL) {
  const base64Xor = textToBase64WithXor(text, key);
  const realLength = base64Xor.length;
  const { grid, rows, columns } = create3xNGrid(base64Xor);
  const diagonal = readGridDiagonally(grid, rows, columns, realLength);
  const withNoise = insertNoiseSymbols(diagonal, interval, noiseSymbol);
  return `${columns}|${interval}|${noiseSymbol.codePointAt(0)}|${realLength}:${withNoise}`;
}

function decodeMessage(encodedText, key) {
  if (!encodedText.includes(":")) {
    throw new Error("Invalid format. Expected a payload header and body separated by ':'.");
  }

  const [header, payload] = encodedText.split(/:(.*)/s, 2);
  const rows = 3;
  let realLength = null;
  let columns;
  let diagonalWithoutNoise;

  if (header.includes("|")) {
    const parts = header.split("|");
    if (![3, 4].includes(parts.length)) {
      throw new Error("Invalid header. Use the format 'columns|interval|symbol' or 'columns|interval|symbol|length'.");
    }

    columns = Number(parts[0]);
    const interval = Number(parts[1]);
    const symbolCodePoint = Number(parts[2]);
    const noiseSymbol = String.fromCodePoint(symbolCodePoint);
    if (parts.length === 4) {
      realLength = Number(parts[3]);
    }
    if ([columns, interval, symbolCodePoint].some((value) => Number.isNaN(value))) {
      throw new Error("Invalid header. Columns, interval and symbol must be integers.");
    }
    diagonalWithoutNoise = removeNoiseByInterval(payload, interval, noiseSymbol);
  } else {
    columns = Number(header);
    if (Number.isNaN(columns)) {
      throw new Error("Invalid header. The number of columns is not an integer.");
    }
    diagonalWithoutNoise = removeLegacyNoiseSymbols(payload);
  }

  if (columns <= 0) {
    throw new Error("Invalid header. The number of columns must be greater than zero.");
  }

  const expected = rows * columns;
  const receivedLength = diagonalWithoutNoise.length;
  let base64Text;

  if (realLength === null) {
    if (receivedLength === expected) {
      const grid = rebuildGridFromDiagonal(diagonalWithoutNoise, rows, columns);
      base64Text = readGridByRows(grid, rows, columns).replaceAll("\0", "");
    } else if (receivedLength >= expected - 2 && receivedLength < expected) {
      realLength = receivedLength;
      const grid = rebuildGridFromDiagonal(diagonalWithoutNoise, rows, columns, realLength);
      base64Text = readGridByRows(grid, rows, columns).replaceAll("\0", "");
    } else {
      throw new Error(`Inconsistent length after noise removal. Expected ${expected} characters, got ${receivedLength}.`);
    }
  } else {
    if (realLength < 0 || realLength > expected) {
      throw new Error("Invalid header. The declared real length does not fit the grid.");
    }
    if (receivedLength !== realLength) {
      throw new Error(`Inconsistent length after noise removal. Expected ${realLength} real characters, got ${receivedLength}.`);
    }
    const grid = rebuildGridFromDiagonal(diagonalWithoutNoise, rows, columns, realLength);
    base64Text = readGridByRows(grid, rows, columns).replaceAll("\0", "");
  }

  return base64ToTextWithXor(base64Text, key);
}

function encryptMessage(text, key) {
  return encodeMessage(text, key);
}

function decryptMessage(text, key) {
  return decodeMessage(text, key);
}
