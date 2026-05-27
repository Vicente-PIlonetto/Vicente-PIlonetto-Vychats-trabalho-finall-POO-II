const App = window.CipherlineApp;
const joinedServers = document.getElementById("joinedServers");
const discoverServers = document.getElementById("discoverServers");
const createServerForm = document.getElementById("createServerForm");
const serverNameInput = document.getElementById("serverNameInput");
const serverPasswordInput = document.getElementById("serverPasswordInput");

let currentUser = null;

App.initLanguage();
App.initTheme();
App.registerServiceWorker();
bootstrap();
createServerForm.addEventListener("submit", handleCreateServer);
window.addEventListener("cipherline:languagechange", () => {
  if (currentUser) {
    App.renderSidebar({ activePage: "servers", user: currentUser });
  }
  refreshServers();
});
window.addEventListener("cipherline:userchange", (event) => {
  currentUser = event.detail.user;
  App.renderSidebar({ activePage: "servers", user: currentUser });
});

async function bootstrap() {
  currentUser = await App.requireSession();
  if (!currentUser) {
    return;
  }
  App.renderSidebar({ activePage: "servers", user: currentUser });
  await refreshServers();
}

async function refreshServers() {
  const [joinedPayload, discoverPayload] = await Promise.all([
    App.apiFetch("/servers"),
    App.apiFetch("/servers/discover"),
  ]);

  renderJoinedServers(joinedPayload.servers);
  renderDiscoverServers(discoverPayload.servers);
}

function renderJoinedServers(servers) {
  App.setDocumentTitle(servers.reduce((total, server) => total + Number(server.unread_count || 0), 0));

  if (!servers.length) {
    joinedServers.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_joined_servers"))}</div>`;
    return;
  }

  joinedServers.innerHTML = servers.map((server) => `
    <div class="server-item ${server.unread_count ? "unread" : ""}">
      <div class="server-header-row">
        <div class="server-heading-text">
          <h3>${App.escapeHtml(server.name)}</h3>
        </div>
        ${server.unread_count ? `<span class="unread-badge">${App.escapeHtml(String(server.unread_count > 99 ? "99+" : server.unread_count))}</span>` : ""}
      </div>
      <p class="server-meta">${App.escapeHtml(server.is_private ? App.t("state_private_server") : App.t("state_public_server"))}</p>
      <p class="server-meta">${App.escapeHtml(App.t("state_members_count", { count: server.member_count }))}</p>
      <button class="primary" data-open-server="${server.id}">${App.escapeHtml(App.t("button_open_chat"))}</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-open-server]").forEach((button) => {
    button.addEventListener("click", () => {
      App.setActiveServerId(button.dataset.openServer);
      window.location.href = "/chat";
    });
  });
}

function renderDiscoverServers(servers) {
  if (!servers.length) {
    discoverServers.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_discover_servers"))}</div>`;
    return;
  }

  discoverServers.innerHTML = servers.map((server) => `
    <div class="server-item ${server.unread_count ? "unread" : ""}">
      <div class="server-header-row">
        <div class="server-heading-text">
          <h3>${App.escapeHtml(server.name)}</h3>
        </div>
        ${server.joined && server.unread_count ? `<span class="unread-badge">${App.escapeHtml(String(server.unread_count > 99 ? "99+" : server.unread_count))}</span>` : ""}
      </div>
      <p class="server-meta">${App.escapeHtml(server.is_private ? App.t("state_private_server") : App.t("state_public_server"))}</p>
      <p class="server-meta">${App.escapeHtml(App.t("state_members_count", { count: server.member_count }))}</p>
      ${server.is_private && !server.joined
        ? `<input class="server-password-input" type="password" maxlength="128" placeholder="${App.escapeHtml(App.t("placeholder_server_password"))}" data-server-password="${server.id}">`
        : ""}
      ${server.is_private && !server.joined
        ? `<p class="small-text">${App.escapeHtml(App.t("state_server_password_required"))}</p>`
        : ""}
      ${server.joined
        ? `<button class="ghost" disabled>${App.escapeHtml(App.t("button_joined"))}</button>`
        : `<button class="join-button" data-join-server="${server.id}">${App.escapeHtml(App.t("button_join_server"))}</button>`}
      <p class="form-error hidden" data-server-error="${server.id}"></p>
    </div>
  `).join("");

  document.querySelectorAll("[data-join-server]").forEach((button) => {
    button.addEventListener("click", async () => {
      const passwordInput = document.querySelector(`[data-server-password="${button.dataset.joinServer}"]`);
      const errorNode = document.querySelector(`[data-server-error="${button.dataset.joinServer}"]`);
      const password = passwordInput instanceof HTMLInputElement ? passwordInput.value : "";
      if (errorNode) {
        errorNode.textContent = "";
        errorNode.classList.add("hidden");
      }
      try {
        await App.apiFetch(`/servers/${button.dataset.joinServer}/join`, {
          method: "POST",
          body: JSON.stringify({ password }),
        });
        await refreshServers();
      } catch (error) {
        if (error.message === "Invalid server password.") {
          if (errorNode) {
            errorNode.textContent = App.t("server_password_invalid");
            errorNode.classList.remove("hidden");
          }
          return;
        }
        throw error;
      }
    });
  });
}

async function handleCreateServer(event) {
  event.preventDefault();
  const name = serverNameInput.value.trim();
  const password = serverPasswordInput.value.trim();
  if (!name) {
    return;
  }

  const payload = await App.apiFetch("/servers", {
    method: "POST",
    body: JSON.stringify({ name, password }),
  });

  serverNameInput.value = "";
  serverPasswordInput.value = "";
  await refreshServers();
}
