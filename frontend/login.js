const App = window.CipherlineApp;
const authForm = document.getElementById("authForm");
const authUsernameInput = document.getElementById("authUsernameInput");
const authPasswordInput = document.getElementById("authPasswordInput");
const authConfirmPasswordInput = document.getElementById("authConfirmPasswordInput");
const authSubmitButton = document.getElementById("authSubmitButton");
const authStatus = document.getElementById("authStatus");
const showLoginButton = document.getElementById("showLoginButton");
const showRegisterButton = document.getElementById("showRegisterButton");
const confirmPasswordGroup = document.getElementById("confirmPasswordGroup");
const googleAuthSection = document.getElementById("googleAuthSection");
const googleAuthButton = document.getElementById("googleAuthButton");

let authMode = "login";
let googleConfig = null;
let googleReady = false;

App.initLanguage();
App.initTheme();
App.registerServiceWorker();
bootstrap();

showLoginButton.addEventListener("click", () => setMode("login"));
showRegisterButton.addEventListener("click", () => setMode("register"));
authForm.addEventListener("submit", handleSubmit);
window.addEventListener("cipherline:languagechange", () => {
  setMode(authMode);
  if (googleConfig?.enabled) {
    renderGoogleButton();
  }
});

async function bootstrap() {
  if (App.getToken()) {
    try {
      await App.apiFetch("/session");
      window.location.href = "/servers";
      return;
    } catch {
      App.clearToken();
    }
  }
  await loadGoogleAuth();
  setMode("login");
}

function setMode(mode) {
  authMode = mode;
  const isLogin = mode === "login";
  authSubmitButton.textContent = isLogin ? App.t("button_login") : App.t("button_register");
  showLoginButton.classList.toggle("active", isLogin);
  showRegisterButton.classList.toggle("active", !isLogin);
  confirmPasswordGroup.classList.toggle("hidden", isLogin);
  authConfirmPasswordInput.required = !isLogin;
  authStatus.textContent = isLogin
    ? App.t("helper_login_mode")
    : App.t("helper_register_mode");
  authStatus.style.color = "var(--muted)";
  googleAuthSection.classList.toggle("hidden", !isLogin || !googleReady);
}

async function handleSubmit(event) {
  event.preventDefault();
  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value;

  if (authMode === "register" && password !== authConfirmPasswordInput.value) {
    authStatus.textContent = App.t("auth_password_mismatch");
    authStatus.style.color = "var(--danger)";
    return;
  }

  try {
    const payload = await App.apiFetch(`/auth/${authMode}`, {
      method: "POST",
      body: JSON.stringify({
        username,
        password,
      }),
    }, false);
    App.setToken(payload.token);
    window.location.href = "/servers";
  } catch (error) {
    authStatus.textContent = error.message;
    authStatus.style.color = "var(--danger)";
  }
}

async function loadGoogleAuth() {
  try {
    googleConfig = await App.apiFetch("/auth/google/config", {}, false);
  } catch {
    googleConfig = { enabled: false, client_id: "" };
  }

  if (!googleConfig.enabled) {
    googleAuthSection.classList.add("hidden");
    return;
  }

  authStatus.textContent = App.t("auth_google_loading");

  const googleLoaded = await waitForGoogleIdentity();
  if (!googleLoaded) {
    authStatus.textContent = App.t("auth_google_unavailable");
    authStatus.style.color = "var(--danger)";
    return;
  }

  window.google.accounts.id.initialize({
    client_id: googleConfig.client_id,
    callback: handleGoogleCredential,
    cancel_on_tap_outside: true,
  });
  renderGoogleButton();
  googleReady = true;
  authStatus.textContent = App.t("helper_login_mode");
  authStatus.style.color = "var(--muted)";
}

function renderGoogleButton() {
  if (!window.google?.accounts?.id || !googleConfig?.enabled) {
    return;
  }
  googleAuthButton.innerHTML = "";
  window.google.accounts.id.renderButton(googleAuthButton, {
    theme: document.documentElement.dataset.theme === "dark" ? "filled_black" : "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    width: 360,
  });
  googleAuthSection.classList.toggle("hidden", authMode !== "login");
}

async function handleGoogleCredential(response) {
  if (!response?.credential) {
    authStatus.textContent = App.t("auth_google_popup_closed");
    authStatus.style.color = "var(--danger)";
    return;
  }

  try {
    const payload = await App.apiFetch("/auth/google", {
      method: "POST",
      body: JSON.stringify({ credential: response.credential }),
    }, false);
    App.setToken(payload.token);
    window.location.href = "/servers";
  } catch (error) {
    authStatus.textContent = error.message || App.t("auth_google_failed");
    authStatus.style.color = "var(--danger)";
  }
}

window.addEventListener("load", () => {
  if (googleConfig?.enabled) {
    renderGoogleButton();
  }
});

async function waitForGoogleIdentity(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (window.google?.accounts?.id) {
      return true;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  return false;
}
