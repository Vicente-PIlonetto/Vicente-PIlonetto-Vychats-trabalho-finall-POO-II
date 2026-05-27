const App = window.CipherlineApp;
const friendsList = document.getElementById("friendsList");
const incomingRequests = document.getElementById("incomingRequests");
const outgoingRequests = document.getElementById("outgoingRequests");
const inviteList = document.getElementById("inviteList");
const addFriendForm = document.getElementById("addFriendForm");
const friendUsernameInput = document.getElementById("friendUsernameInput");
const addFriendError = document.getElementById("addFriendError");
const inviteCodeInput = document.getElementById("inviteCodeInput");
const acceptInviteButton = document.getElementById("acceptInviteButton");
const createInviteButton = document.getElementById("createInviteButton");
const inviteCodeOutput = document.getElementById("inviteCodeOutput");
const copyInviteCodeButton = document.getElementById("copyInviteCodeButton");

let currentUser = null;

App.initLanguage();
App.initTheme();
App.registerServiceWorker();
bootstrap();

addFriendForm.addEventListener("submit", handleAddFriend);
acceptInviteButton.addEventListener("click", handleAcceptInvite);
createInviteButton.addEventListener("click", handleCreateInvite);
copyInviteCodeButton.addEventListener("click", handleCopyInvite);

window.addEventListener("cipherline:languagechange", () => {
  if (currentUser) {
    App.renderSidebar({ activePage: "friends", user: currentUser });
  }
  refreshFriends();
});
window.addEventListener("cipherline:userchange", (event) => {
  currentUser = event.detail.user;
  App.renderSidebar({ activePage: "friends", user: currentUser });
});

async function bootstrap() {
  currentUser = await App.requireSession();
  if (!currentUser) {
    return;
  }
  App.renderSidebar({ activePage: "friends", user: currentUser });
  await refreshFriends();
}

async function refreshFriends() {
  const payload = await App.apiFetch("/friends");
  renderFriends(payload.friends || []);
  renderIncoming(payload.incoming_requests || []);
  renderOutgoing(payload.outgoing_requests || []);
  renderInvites(payload.invites || []);
}

function renderFriends(friends) {
  if (!friends.length) {
    friendsList.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_friends"))}</div>`;
    return;
  }

  friendsList.innerHTML = friends.map((friend) => `
    <div class="member-item">
      <div class="member-preview-row">
        <div class="member-profile-row member-preview-text">
          ${renderAvatar(friend)}
          <div class="member-text-stack">
            <strong>${App.escapeHtml(friend.username)}</strong>
            ${renderStatus(friend)}
          </div>
        </div>
        <div class="inline-form">
          <button class="ghost" data-message-user="${friend.id}">${App.escapeHtml(App.t("button_message_user"))}</button>
          <button class="ghost" data-remove-friend="${friend.id}">${App.escapeHtml(App.t("button_remove_friend"))}</button>
        </div>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-message-user]").forEach((button) => {
    button.addEventListener("click", () => {
      App.setActiveDirectMessageUserId(button.dataset.messageUser);
      window.location.href = "/dms";
    });
  });

  document.querySelectorAll("[data-remove-friend]").forEach((button) => {
    button.addEventListener("click", async () => {
      await App.apiFetch(`/friends/${button.dataset.removeFriend}`, { method: "DELETE" });
      await refreshFriends();
    });
  });
}

function renderIncoming(requests) {
  if (!requests.length) {
    incomingRequests.innerHTML = `<div class="empty-state">${App.escapeHtml(App.t("state_no_requests"))}</div>`;
    return;
  }

  incomingRequests.innerHTML = requests.map((request) => `
    <div class="member-item">
      <div class="member-preview-row">
        <div class="member-profile-row member-preview-text">
          ${renderAvatar(request.user)}
          <div class="member-text-stack">
            <strong>${App.escapeHtml(request.user.username)}</strong>
            ${renderStatus(request.user)}
          </div>
        </div>
        <div class="inline-form">
          <button class="primary" data-accept-request="${request.id}">${App.escapeHtml(App.t("button_accept"))}</button>
          <button class="ghost" data-decline-request="${request.id}">${App.escapeHtml(App.t("button_decline"))}</button>
        </div>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-accept-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await App.apiFetch(`/friends/requests/${button.dataset.acceptRequest}/accept`, { method: "POST" });
      await refreshFriends();
    });
  });
  document.querySelectorAll("[data-decline-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await App.apiFetch(`/friends/requests/${button.dataset.declineRequest}/decline`, { method: "POST" });
      await refreshFriends();
    });
  });
}

function renderOutgoing(requests) {
  if (!requests.length) {
    outgoingRequests.innerHTML = "";
    return;
  }

  outgoingRequests.innerHTML = requests.map((request) => `
    <div class="member-item">
      <div class="member-preview-row">
        <div class="member-profile-row member-preview-text">
          ${renderAvatar(request.user)}
          <div class="member-text-stack">
            <strong>${App.escapeHtml(request.user.username)}</strong>
            ${renderStatus(request.user)}
          </div>
        </div>
        <button class="ghost" data-cancel-request="${request.id}">${App.escapeHtml(App.t("button_cancel"))}</button>
      </div>
    </div>
  `).join("");

  document.querySelectorAll("[data-cancel-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await App.apiFetch(`/friends/requests/${button.dataset.cancelRequest}/decline`, { method: "POST" });
      await refreshFriends();
    });
  });
}

function renderInvites(invites) {
  if (!invites.length) {
    inviteList.innerHTML = "";
    return;
  }

  inviteList.innerHTML = invites.map((invite) => `
    <div class="invite-url">${App.escapeHtml(invite.code)}</div>
  `).join("");
}

async function handleAddFriend(event) {
  event.preventDefault();
  const username = friendUsernameInput.value.trim();
  if (addFriendError) {
    addFriendError.textContent = "";
    addFriendError.classList.add("hidden");
  }
  if (!username) {
    return;
  }
  try {
    await App.apiFetch("/friends/requests", {
      method: "POST",
      body: JSON.stringify({ username }),
    });
    friendUsernameInput.value = "";
    await refreshFriends();
  } catch (error) {
    if (addFriendError) {
      addFriendError.textContent = error.message;
      addFriendError.classList.remove("hidden");
    }
  }
}

async function handleCreateInvite() {
  const payload = await App.apiFetch("/friends/invites", { method: "POST" });
  if (inviteCodeOutput) {
    inviteCodeOutput.textContent = payload.code;
    inviteCodeOutput.classList.remove("hidden");
  }
  if (copyInviteCodeButton) {
    copyInviteCodeButton.classList.remove("hidden");
  }
  await refreshFriends();
}

async function handleCopyInvite() {
  if (!inviteCodeOutput || !inviteCodeOutput.textContent) {
    return;
  }
  try {
    await navigator.clipboard.writeText(inviteCodeOutput.textContent);
  } catch {
  }
}

async function handleAcceptInvite() {
  const code = inviteCodeInput.value.trim();
  if (!code) {
    return;
  }
  await App.apiFetch("/friends/invites/accept", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
  inviteCodeInput.value = "";
  await refreshFriends();
}

function renderAvatar(user) {
  if (user.avatar_url) {
    return `<img class="member-avatar" src="${App.escapeHtml(user.avatar_url)}" alt="${App.escapeHtml(user.username)}">`;
  }
  return `<div class="member-avatar-fallback">${App.escapeHtml(App.getInitials(user.username))}</div>`;
}

function renderStatus(user) {
  const isOnline = Boolean(user?.is_online);
  const label = App.t(isOnline ? "state_user_online" : "state_user_offline");
  return `
    <span class="user-status ${isOnline ? "is-online" : "is-offline"}">
      ${App.escapeHtml(label)}
    </span>
  `;
}
