const App = window.CipherlineApp;
const dmUsersList = document.getElementById("dmUsersList");

let currentUser = null;
let refreshTimer = 0;

App.initLanguage();
App.initTheme();
bootstrap();

window.addEventListener("cipherline:languagechange", () => {
  if (currentUser) {
    App.renderSidebar({ activePage: "dms", user: currentUser });
  }
  refreshUsers();
});
window.addEventListener("cipherline:userchange", (event) => {
  currentUser = event.detail.user;
  App.renderSidebar({ activePage: "dms", user: currentUser });
  refreshUsers();
});

async function bootstrap() {
  currentUser = await App.requireSession();
  if (!currentUser) {
    return;
  }

  App.renderSidebar({ activePage: "dms", user: currentUser });
  await refreshUsers();
  if (!refreshTimer) {
    refreshTimer = window.setInterval(refreshUsers, 12000);
  }
}

async function refreshUsers() {
  const payload = await App.apiFetch("/friends");
  const users = payload.friends || [];

  if (!users.length) {
    dmUsersList.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_friends"))}</div>`;
    return;
  }

  dmUsersList.innerHTML = users.map((user) => `
    <div class="server-item">
      <div class="member-profile-row">
        ${user.avatar_url
          ? `<img class="member-avatar" src="${App.escapeHtml(user.avatar_url)}" alt="${App.escapeHtml(user.username)}">`
          : `<div class="member-avatar-fallback">${App.escapeHtml(App.getInitials(user.username))}</div>`}
        <div class="member-text-stack">
          <h3>${App.escapeHtml(user.username)}</h3>
          ${renderUserStatus(user)}
        </div>
      </div>
      <button class="primary" data-open-dm-user="${user.id}">${App.escapeHtml(App.t("button_message_user"))}</button>
    </div>
  `).join("");

  document.querySelectorAll("[data-open-dm-user]").forEach((button) => {
    button.addEventListener("click", () => {
      App.setActiveDirectMessageUserId(button.dataset.openDmUser);
      window.location.href = "/dms";
    });
  });
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
