window.CipherlineApp = (() => {
  const API_BASE = "/api";
  const THEME_STORAGE_KEY = "cipherline-theme";
  const LANGUAGE_STORAGE_KEY = "cipherline-language";
  const SESSION_STORAGE_KEY = "cipherline-session-token";
  const ACTIVE_SERVER_STORAGE_KEY = "cipherline-active-server";
  const ACTIVE_DIRECT_MESSAGE_STORAGE_KEY = "cipherline-active-dm";
  const DM_NOTIFICATION_STATE_KEY = "cipherline-dm-notification-state";
  const SIDEBAR_COLLAPSED_KEY = "cipherline-sidebar-collapsed";
  const DEFAULT_NOISE_SYMBOL = "#";
  const DEFAULT_NOISE_INTERVAL = 4;
  const LEGACY_FAKE_SYMBOLS = new Set(["#", "@", "%", "&", "*", "!"]);
  const FALLBACK_LANGUAGE = "en";
  let dmNotificationSocket = null;
  let dmNotificationReconnectTimer = 0;
  let dmNotificationUserId = "";
  let notificationAudioContext = null;
  const TRANSLATIONS = {
    en: {
      app_name: "VyChat",
      page_title_login: "VyChat Login",
      page_title_servers: "VyChat Servers",
      page_title_chat: "VyChat Chat",
      page_title_dms: "VyChat Direct Messages",
      page_title_dm_users: "VyChat New Direct Message",
      page_title_settings: "VyChat Settings",
      eyebrow_encrypted_server_chat: "Encrypted Server Chat",
      eyebrow_control_panel: "Control Panel",
      eyebrow_account: "Account",
      eyebrow_direct_link: "Direct Link",
      eyebrow_session: "Session",
      eyebrow_settings: "Settings",
      eyebrow_transport: "Transport",
      eyebrow_servers: "Servers",
      eyebrow_joined: "Joined",
      eyebrow_discover: "Discover",
      eyebrow_active_server: "Active server",
      eyebrow_members: "Members",
      label_username: "Username",
      label_password: "Password",
      label_display_name: "Name",
      label_email: "Email",
      label_current_password: "Current password",
      label_new_password: "New password",
      label_confirm_password: "Confirm password",
      label_socket_endpoint: "WebSocket endpoint",
      label_message: "Message",
      label_status: "Status",
      label_custom_status: "Custom status",
      helper_login_intro: "Create an account or log in to manage your servers and open server-specific chats.",
      helper_login_status: "Use your account to continue. Users are stored in backend/data/store.json.",
      helper_login_mode: "Use your account to continue.",
      helper_register_mode: "Create a new account. Users are stored in backend/data/store.json.",
      helper_transport_fixed: "The app uses a fixed socket based on the current URL.",
      helper_transport_click_connect: "The app uses the socket from the current URL and connects automatically.",
      helper_transport_connecting: "Connecting to live updates...",
      helper_transport_connected: "Connected. You can send messages now.",
      helper_transport_disconnected: "Disconnected.",
      helper_transport_failed: "Connection failed. Check whether the server is reachable.",
      tab_login: "Login",
      tab_register: "Register",
      nav_chat: "Chat",
      nav_direct_messages: "DMs",
      nav_friends: "Friends",
      nav_settings: "Settings",
      button_login: "Login",
      button_register: "Register",
      button_copy_link: "Copy link",
      button_copied: "Copied",
      button_logout: "Logout",
      button_create: "Create",
      button_add_friend: "Add friend",
      button_accept: "Accept",
      button_decline: "Decline",
      button_remove_friend: "Remove",
      button_create_invite: "Create invite",
      button_open_chat: "Open chat",
      button_join_server: "Join server",
      button_start_dm: "Open DMs",
      button_joined: "Joined",
      button_connect: "Connect",
      button_disconnect: "Disconnect",
      button_send: "Send",
      button_attach: "Attach",
      button_audio: "Record",
      button_stop_recording: "Stop",
      button_new_message: "New message",
      button_change_photo: "Change photo",
      button_google: "Continue with Google",
      button_message_user: "Message",
      button_return_to_server: "Back to server",
      button_reply: "Reply",
      button_edit: "Edit",
      button_remove_attachments: "Remove attachments",
      button_delete: "Delete",
      button_cancel: "Cancel",
      button_save: "Save",
      heading_invite: "Invite",
      heading_actions: "Actions",
      heading_settings: "Settings",
      heading_direct_messages: "Direct messages",
      heading_friends: "Friends",
      heading_friend_requests: "Friend requests",
      heading_friend_invites: "Friend invites",
      heading_add_friend: "Add friend",
      heading_people: "People",
      heading_start_direct_message: "Start a direct message",
      heading_no_direct_selected: "No direct message selected",
      heading_live_socket: "Live socket",
      heading_your_spaces: "Your spaces",
      heading_my_servers: "My servers",
      heading_available_servers: "Available servers",
      heading_no_server_selected: "No server selected",
      heading_create_server: "Create server",
      placeholder_username: "Ex. viko",
      placeholder_password: "At least 6 characters",
      placeholder_confirm_password: "Repeat your password",
      placeholder_server_name: "New server name",
      placeholder_server_password: "Optional server password",
      placeholder_message: "Write a message",
      placeholder_attachment: "No file selected",
      placeholder_friend_username: "Friend username",
      member_owner: "Owner",
      member_member: "Member",
      state_no_messages: "No messages yet in this server.",
      state_no_direct_messages: "No direct messages yet.",
      state_select_direct_conversation: "Select a direct message or start one from the new message page.",
      state_no_people: "No other users available.",
      state_direct_with: "Direct with {username}",
      state_active_direct: "Direct message",
      state_active_server: "Active server",
      state_no_joined_servers: "You have not joined any servers yet.",
      state_no_discover_servers: "No servers available yet.",
      state_private_server: "Private server",
      state_public_server: "Public server",
      state_server_password_required: "This server requires a password.",
      state_members_count: "{count} members",
      state_socket_offline: "Offline",
      state_socket_connecting: "Connecting",
      state_socket_online: "Online",
      state_socket_error: "Error",
      state_user_online: "Online",
      state_user_offline: "Offline",
      state_status_online: "Online",
      state_status_offline: "Offline",
      state_status_dnd: "Do not disturb",
      state_status_meeting: "In a meeting",
      state_friend_added: "Friend added",
      state_request_sent: "Request sent",
      state_no_friends: "No friends yet.",
      state_no_requests: "No pending requests.",
      state_you: "You",
      state_system: "System",
      state_attachment_image: "Image",
      state_attachment_audio: "Audio",
      state_attachment_file: "File",
      state_recording_voice: "Recording voice...",
      state_uploading_attachments: "Uploading attachments...",
      state_message_deleted: "Message deleted",
      state_message_edited: "edited",
      state_replying_to: "Replying to {username}",
      state_editing_message: "Editing your message",
      auth_password_mismatch: "Password confirmation does not match.",
      auth_google_unavailable: "Google sign-in is not configured on this server.",
      auth_google_loading: "Loading Google sign-in...",
      auth_google_failed: "Google sign-in failed.",
      auth_google_popup_closed: "Google sign-in was cancelled.",
      server_password_invalid: "Invalid server password.",
      chat_decode_error: "Unable to decode live message: {message}",
      chat_socket_closed: "Socket closed.",
      chat_socket_closed_reason: "Socket closed: {reason}",
      chat_socket_queueing: "Socket was offline. Reconnecting and queueing your message.",
      chat_send_failed: "Message send failed: {message}",
      upload_avatar_failed: "Avatar upload failed: {message}",
      upload_attachment_failed: "Attachment upload failed: {message}",
      attachment_limit_reached: "Maximum 5 attachments per message.",
      recording_not_supported: "Voice recording is not supported in this browser.",
      recording_permission_denied: "Microphone access was denied.",
      recording_failed: "Voice recording failed: {message}",
      theme_to_light: "Switch to light mode",
      theme_to_dark: "Switch to dark mode",
      language_toggle_title: "Switch language",
      sidebar_collapse: "Collapse sidebar",
      sidebar_expand: "Expand sidebar",
    },
    pt: {
      app_name: "VyChat",
      page_title_login: "Login VyChat",
      page_title_servers: "Servidores VyChat",
      page_title_chat: "Chat VyChat",
      page_title_dms: "Mensagens diretas VyChat",
      page_title_dm_users: "Nova mensagem direta VyChat",
      page_title_settings: "Configuracoes VyChat",
      eyebrow_encrypted_server_chat: "Chat criptografado por servidor",
      eyebrow_control_panel: "Painel de controle",
      eyebrow_account: "Conta",
      eyebrow_direct_link: "Link direto",
      eyebrow_session: "Sessao",
      eyebrow_settings: "Configuracoes",
      eyebrow_transport: "Transporte",
      eyebrow_servers: "Servidores",
      eyebrow_joined: "Entrou",
      eyebrow_discover: "Explorar",
      eyebrow_active_server: "Servidor ativo",
      eyebrow_members: "Membros",
      label_username: "Usuario",
      label_password: "Senha",
      label_display_name: "Nome",
      label_email: "Email",
      label_current_password: "Senha atual",
      label_new_password: "Nova senha",
      label_confirm_password: "Confirmar senha",
      label_socket_endpoint: "Endpoint WebSocket",
      label_message: "Mensagem",
      label_status: "Status",
      label_custom_status: "Status personalizado",
      helper_login_intro: "Crie uma conta ou entre para gerenciar seus servidores e abrir chats por servidor.",
      helper_login_status: "Use sua conta para continuar. Os usuarios sao salvos em backend/data/store.json.",
      helper_login_mode: "Use sua conta para continuar.",
      helper_register_mode: "Crie uma nova conta. Os usuarios sao salvos em backend/data/store.json.",
      helper_transport_fixed: "O app usa um socket fixo baseado na URL atual.",
      helper_transport_click_connect: "O app usa o socket da URL atual e conecta automaticamente.",
      helper_transport_connecting: "Conectando as atualizacoes em tempo real...",
      helper_transport_connected: "Conectado. Agora voce pode enviar mensagens.",
      helper_transport_disconnected: "Desconectado.",
      helper_transport_failed: "Falha na conexao. Verifique se o servidor esta acessivel.",
      tab_login: "Entrar",
      tab_register: "Registrar",
      nav_chat: "Chat",
      nav_direct_messages: "DMs",
      nav_friends: "Amigos",
      nav_settings: "Configuracoes",
      button_login: "Entrar",
      button_register: "Registrar",
      button_copy_link: "Copiar link",
      button_copied: "Copiado",
      button_logout: "Sair",
      button_create: "Criar",
      button_add_friend: "Adicionar amigo",
      button_accept: "Aceitar",
      button_decline: "Recusar",
      button_remove_friend: "Remover",
      button_create_invite: "Criar convite",
      button_open_chat: "Abrir chat",
      button_join_server: "Entrar no servidor",
      button_start_dm: "Abrir DMs",
      button_joined: "Entrou",
      button_connect: "Conectar",
      button_disconnect: "Desconectar",
      button_send: "Enviar",
      button_attach: "Anexar",
      button_audio: "Gravar",
      button_stop_recording: "Parar",
      button_new_message: "Nova mensagem",
      button_change_photo: "Trocar foto",
      button_google: "Continuar com Google",
      button_message_user: "Mensagem",
      button_return_to_server: "Voltar ao servidor",
      button_reply: "Responder",
      button_edit: "Editar",
      button_remove_attachments: "Remover anexos",
      button_delete: "Apagar",
      button_cancel: "Cancelar",
      button_save: "Salvar",
      heading_invite: "Convite",
      heading_actions: "Acoes",
      heading_settings: "Configuracoes",
      heading_direct_messages: "Mensagens diretas",
      heading_friends: "Amigos",
      heading_friend_requests: "Pedidos de amizade",
      heading_friend_invites: "Convites de amizade",
      heading_add_friend: "Adicionar amigo",
      heading_people: "Pessoas",
      heading_start_direct_message: "Iniciar mensagem direta",
      heading_no_direct_selected: "Nenhuma mensagem direta selecionada",
      heading_live_socket: "Socket ao vivo",
      heading_your_spaces: "Seus espacos",
      heading_my_servers: "Meus servidores",
      heading_available_servers: "Servidores disponiveis",
      heading_no_server_selected: "Nenhum servidor selecionado",
      heading_create_server: "Criar servidor",
      placeholder_username: "Ex. viko",
      placeholder_password: "Pelo menos 6 caracteres",
      placeholder_confirm_password: "Repita sua senha",
      placeholder_server_name: "Nome do novo servidor",
      placeholder_server_password: "Senha opcional do servidor",
      placeholder_message: "Escreva uma mensagem",
      placeholder_attachment: "Nenhum arquivo selecionado",
      placeholder_friend_username: "Usuario do amigo",
      member_owner: "Dono",
      member_member: "Membro",
      state_no_messages: "Ainda nao ha mensagens neste servidor.",
      state_no_direct_messages: "Ainda nao ha mensagens diretas.",
      state_select_direct_conversation: "Selecione uma mensagem direta ou inicie uma pela pagina de nova mensagem.",
      state_no_people: "Nenhum outro usuario disponivel.",
      state_direct_with: "Direto com {username}",
      state_active_direct: "Mensagem direta",
      state_active_server: "Servidor ativo",
      state_no_joined_servers: "Voce ainda nao entrou em nenhum servidor.",
      state_no_discover_servers: "Ainda nao ha servidores disponiveis.",
      state_private_server: "Servidor privado",
      state_public_server: "Servidor publico",
      state_server_password_required: "Este servidor exige senha.",
      state_members_count: "{count} membros",
      state_socket_offline: "Offline",
      state_socket_connecting: "Conectando",
      state_socket_online: "Online",
      state_socket_error: "Erro",
      state_user_online: "Online",
      state_user_offline: "Offline",
      state_status_online: "Online",
      state_status_offline: "Offline",
      state_status_dnd: "Nao incomodar",
      state_status_meeting: "Em reuniao",
      state_friend_added: "Amigo adicionado",
      state_request_sent: "Pedido enviado",
      state_no_friends: "Nenhum amigo ainda.",
      state_no_requests: "Sem pedidos pendentes.",
      state_you: "Voce",
      state_system: "Sistema",
      state_attachment_image: "Imagem",
      state_attachment_audio: "Audio",
      state_attachment_file: "Arquivo",
      state_recording_voice: "Gravando voz...",
      state_uploading_attachments: "Enviando anexos...",
      state_message_deleted: "Mensagem apagada",
      state_message_edited: "editada",
      state_replying_to: "Respondendo {username}",
      state_editing_message: "Editando sua mensagem",
      auth_password_mismatch: "A confirmacao da senha nao confere.",
      auth_google_unavailable: "O login com Google nao esta configurado neste servidor.",
      auth_google_loading: "Carregando login com Google...",
      auth_google_failed: "Falha no login com Google.",
      auth_google_popup_closed: "O login com Google foi cancelado.",
      server_password_invalid: "Senha do servidor invalida.",
      chat_decode_error: "Nao foi possivel ler a mensagem ao vivo: {message}",
      chat_socket_closed: "Socket fechado.",
      chat_socket_closed_reason: "Socket fechado: {reason}",
      chat_socket_queueing: "O socket estava offline. Reconectando e colocando sua mensagem na fila.",
      chat_send_failed: "Falha ao enviar mensagem: {message}",
      upload_avatar_failed: "Falha ao enviar foto: {message}",
      upload_attachment_failed: "Falha ao enviar anexo: {message}",
      attachment_limit_reached: "No maximo 5 anexos por mensagem.",
      recording_not_supported: "Gravacao de voz nao e suportada neste navegador.",
      recording_permission_denied: "O acesso ao microfone foi negado.",
      recording_failed: "Falha na gravacao de voz: {message}",
      theme_to_light: "Mudar para modo claro",
      theme_to_dark: "Mudar para modo escuro",
      language_toggle_title: "Mudar idioma",
      sidebar_collapse: "Minimizar sidebar",
      sidebar_expand: "Expandir sidebar",
    },
  };

  function getLanguage() {
    const language = localStorage.getItem(LANGUAGE_STORAGE_KEY) || FALLBACK_LANGUAGE;
    return Object.hasOwn(TRANSLATIONS, language) ? language : FALLBACK_LANGUAGE;
  }

  function t(key, params = {}) {
    const language = getLanguage();
    const template = TRANSLATIONS[language]?.[key] ?? TRANSLATIONS[FALLBACK_LANGUAGE]?.[key] ?? key;
    return Object.entries(params).reduce(
      (result, [paramKey, paramValue]) => result.replaceAll(`{${paramKey}}`, String(paramValue)),
      template,
    );
  }

  function getToken() {
    return localStorage.getItem(SESSION_STORAGE_KEY) || "";
  }

  function setToken(token) {
    localStorage.setItem(SESSION_STORAGE_KEY, token);
  }

  function clearToken() {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_SERVER_STORAGE_KEY);
    localStorage.removeItem(ACTIVE_DIRECT_MESSAGE_STORAGE_KEY);
    stopGlobalDirectMessageWatcher();
  }

  function applyTranslations(root = document) {
    document.documentElement.lang = getLanguage();

    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    root.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((element) => {
      const value = t(element.dataset.i18nTitle);
      element.setAttribute("title", value);
      if (element.hasAttribute("aria-label")) {
        element.setAttribute("aria-label", value);
      }
    });
  }

  function setLanguage(language) {
    const normalizedLanguage = Object.hasOwn(TRANSLATIONS, language) ? language : FALLBACK_LANGUAGE;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, normalizedLanguage);
    applyTranslations();
    updateLanguageToggle();
    applyTheme(document.documentElement.dataset.theme || localStorage.getItem(THEME_STORAGE_KEY) || "dark");
    window.dispatchEvent(new CustomEvent("cipherline:languagechange", { detail: { language: normalizedLanguage } }));
  }

  function updateLanguageToggle() {
    const languageToggle = document.getElementById("languageToggle");
    if (!languageToggle) {
      return;
    }
    languageToggle.textContent = getLanguage().toUpperCase();
    languageToggle.setAttribute("title", t("language_toggle_title"));
    languageToggle.setAttribute("aria-label", t("language_toggle_title"));
  }

  function initLanguage() {
    applyTranslations();
    updateLanguageToggle();
    const languageToggle = document.getElementById("languageToggle");
    if (languageToggle && !languageToggle.dataset.bound) {
      languageToggle.dataset.bound = "true";
      languageToggle.addEventListener("click", () => {
        setLanguage(getLanguage() === "en" ? "pt" : "en");
      });
    }
  }

  function getActiveServerId() {
    return localStorage.getItem(ACTIVE_SERVER_STORAGE_KEY) || "";
  }

  function setActiveServerId(serverId) {
    localStorage.setItem(ACTIVE_SERVER_STORAGE_KEY, serverId);
    localStorage.removeItem(ACTIVE_DIRECT_MESSAGE_STORAGE_KEY);
  }

  function getActiveDirectMessageUserId() {
    return localStorage.getItem(ACTIVE_DIRECT_MESSAGE_STORAGE_KEY) || "";
  }

  function setActiveDirectMessageUserId(userId) {
    localStorage.setItem(ACTIVE_DIRECT_MESSAGE_STORAGE_KEY, userId);
  }

  async function apiFetch(path, options = {}, includeAuth = true) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
    if (!headers.has("Content-Type") && options.body && !isFormData) {
      headers.set("Content-Type", "application/json");
    }
    if (includeAuth && token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || "Request failed.");
    }
    return payload;
  }

  async function requireSession() {
    const token = getToken();
    if (!token) {
      window.location.href = "/login";
      return null;
    }

    try {
      const payload = await apiFetch("/session");
      startGlobalDirectMessageWatcher(payload.user);
      return payload.user;
    } catch {
      clearToken();
      window.location.href = "/login";
      return null;
    }
  }

  function logout() {
    clearToken();
    window.location.href = "/login";
  }

  function applyTheme(theme) {
    const normalizedTheme = theme === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = normalizedTheme;
    const isDark = normalizedTheme === "dark";
    const icon = document.getElementById("themeToggleIcon");
    const toggle = document.getElementById("themeToggle");
    if (icon) {
      icon.textContent = isDark ? "L" : "D";
    }
    if (toggle) {
      toggle.setAttribute("aria-label", isDark ? t("theme_to_light") : t("theme_to_dark"));
      toggle.setAttribute("title", isDark ? t("theme_to_light") : t("theme_to_dark"));
    }
  }

  function initTheme() {
    applyTheme(localStorage.getItem(THEME_STORAGE_KEY) || "dark");
    const toggle = document.getElementById("themeToggle");
    if (toggle) {
      toggle.addEventListener("click", () => {
        const currentTheme = document.documentElement.dataset.theme || "light";
        const nextTheme = currentTheme === "dark" ? "light" : "dark";
        localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
      });
    }
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }
    navigator.serviceWorker.register("/static/sw.js").catch(() => {});
  }

  function isSidebarCollapsed() {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
  }

  function isMobileSidebar() {
    return window.matchMedia("(max-width: 980px)").matches;
  }

  function isSidebarOpen() {
    return document.documentElement.dataset.sidebarOpen === "true";
  }

  function setSidebarOpen(open) {
    document.documentElement.dataset.sidebarOpen = open ? "true" : "false";
  }

  function applySidebarState(collapsed) {
    document.documentElement.dataset.sidebar = collapsed ? "collapsed" : "expanded";
    const toggle = document.getElementById("sidebarToggle");
    if (!toggle) {
      return;
    }
    const label = collapsed ? t("sidebar_expand") : t("sidebar_collapse");
    toggle.textContent = collapsed ? ">>" : "<<";
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
  }

  function initSidebarToggle() {
    const toggle = document.getElementById("sidebarToggle");
    const mobileButton = document.getElementById("mobileSidebarButton");
    applySidebarState(isSidebarCollapsed());
    setSidebarOpen(false);
    if (!toggle || toggle.dataset.bound) {
      if (mobileButton && !mobileButton.dataset.bound) {
        mobileButton.dataset.bound = "true";
        mobileButton.addEventListener("click", () => setSidebarOpen(true));
      }
      if (mobileButton) {
        const label = t("sidebar_expand");
        mobileButton.setAttribute("aria-label", label);
        mobileButton.setAttribute("title", label);
      }
      return;
    }
    toggle.dataset.bound = "true";
    toggle.addEventListener("click", () => {
      if (isMobileSidebar()) {
        setSidebarOpen(!isSidebarOpen());
        return;
      }
      const nextState = !isSidebarCollapsed();
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, nextState ? "1" : "0");
      applySidebarState(nextState);
    });

    const overlay = document.getElementById("sidebarOverlay");
    if (overlay && !overlay.dataset.bound) {
      overlay.dataset.bound = "true";
      overlay.addEventListener("click", () => setSidebarOpen(false));
    }

    if (mobileButton && !mobileButton.dataset.bound) {
      mobileButton.dataset.bound = "true";
      mobileButton.addEventListener("click", () => setSidebarOpen(true));
    }
    if (mobileButton) {
      const label = t("sidebar_expand");
      mobileButton.setAttribute("aria-label", label);
      mobileButton.setAttribute("title", label);
    }

    document.querySelectorAll("[data-nav]").forEach((link) => {
      if (link.dataset.sidebarBound) {
        return;
      }
      link.dataset.sidebarBound = "true";
      link.addEventListener("click", () => {
        if (isMobileSidebar()) {
          setSidebarOpen(false);
        }
      });
    });

    const mediaQuery = window.matchMedia("(max-width: 980px)");
    const handleResize = () => {
      if (!isMobileSidebar()) {
        setSidebarOpen(false);
      }
    };
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener("change", handleResize);
    } else {
      mediaQuery.addListener(handleResize);
    }

    window.addEventListener("cipherline:languagechange", () => {
      applySidebarState(isSidebarCollapsed());
      if (mobileButton) {
        const label = t("sidebar_expand");
        mobileButton.setAttribute("aria-label", label);
        mobileButton.setAttribute("title", label);
      }
    });
  }

  function renderSidebar({ activePage, user, showTransport = false }) {
    const username = document.getElementById("sidebarUsername");
    if (username) {
      const displayName = user.display_name || user.username;
      username.textContent = displayName;
      username.setAttribute("title", displayName);
    }

    const avatar = document.getElementById("sidebarAvatar");
    const avatarFallback = document.getElementById("sidebarAvatarFallback");
    if (avatar && avatarFallback) {
      if (user.avatar_url) {
        avatar.src = user.avatar_url;
        avatar.classList.remove("hidden");
        avatarFallback.classList.add("hidden");
      } else {
        avatar.removeAttribute("src");
        avatar.classList.add("hidden");
        avatarFallback.textContent = getInitials(user.username);
        avatarFallback.classList.remove("hidden");
      }
    }

    document.querySelectorAll("[data-nav]").forEach((link) => {
      link.classList.toggle("active", link.dataset.nav === activePage);
    });

    const logoutButton = document.getElementById("logoutButton");
    if (logoutButton) {
      logoutButton.addEventListener("click", logout);
    }

    const avatarInput = document.getElementById("avatarInput");
    const changeAvatarButton = document.getElementById("changeAvatarButton");
    if (avatarInput && changeAvatarButton && !changeAvatarButton.dataset.bound) {
      changeAvatarButton.dataset.bound = "true";
      changeAvatarButton.addEventListener("click", () => avatarInput.click());
      avatarInput.addEventListener("change", async () => {
        const file = avatarInput.files?.[0];
        if (!file) {
          return;
        }
        const formData = new FormData();
        formData.append("file", file);
        try {
          const payload = await apiFetch("/users/avatar", { method: "POST", body: formData });
          renderSidebar({ activePage, user: payload.user, showTransport });
          window.dispatchEvent(new CustomEvent("cipherline:userchange", { detail: { user: payload.user } }));
        } catch (error) {
          window.alert(t("upload_avatar_failed", { message: error.message }));
        } finally {
          avatarInput.value = "";
        }
      });
    }

    const transportCard = document.getElementById("transportCard");
    if (transportCard) {
      transportCard.classList.toggle("hidden", !showTransport);
    }

    const inviteUrl = document.getElementById("inviteUrl");
    if (inviteUrl) {
      inviteUrl.textContent = `${window.location.origin}/login`;
    }

    const copyInviteButton = document.getElementById("copyInviteButton");
    if (copyInviteButton && !copyInviteButton.dataset.bound) {
      copyInviteButton.dataset.bound = "true";
      copyInviteButton.addEventListener("click", async () => {
        const value = `${window.location.origin}/login`;
        try {
          await navigator.clipboard.writeText(value);
          copyInviteButton.textContent = t("button_copied");
          setTimeout(() => {
            copyInviteButton.textContent = t("button_copy_link");
          }, 1200);
        } catch {
          copyInviteButton.textContent = value;
        }
      });
    }

    initSidebarToggle();
    loadProfileForm(user);
    bindStatusControls(user);

  }

  function bindStatusControls(user) {
    const modeSelect = document.getElementById("sidebarStatusMode");
    const textInput = document.getElementById("sidebarStatusText");
    if (!modeSelect || !textInput) {
      return;
    }

    modeSelect.value = (user.status_mode || "online").toLowerCase();
    textInput.value = user.status_text || "";

    if (modeSelect.dataset.bound) {
      return;
    }
    modeSelect.dataset.bound = "true";
    textInput.dataset.bound = "true";

    let debounceTimer = 0;
    const saveStatus = async () => {
      const payload = {
        status_mode: (modeSelect.value || "online").toLowerCase(),
        status_text: textInput.value.trim(),
      };
      try {
        const response = await apiFetch("/users/me", {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        window.dispatchEvent(new CustomEvent("cipherline:userchange", { detail: { user: response.user } }));
      } catch (error) {
        window.alert(error.message || "Failed to update status.");
      }
    };

    modeSelect.addEventListener("change", () => {
      void saveStatus();
    });
    textInput.addEventListener("input", () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        void saveStatus();
      }, 600);
    });
    textInput.addEventListener("blur", () => {
      window.clearTimeout(debounceTimer);
      void saveStatus();
    });
  }

  async function loadProfileForm(sessionUser) {
    const form = document.getElementById("profileForm");
    if (!form || form.dataset.bound) {
      return;
    }
    form.dataset.bound = "true";
    const errorNode = document.getElementById("profileError");
    const nameInput = document.getElementById("profileNameInput");
    const usernameInput = document.getElementById("profileUsernameInput");
    const emailInput = document.getElementById("profileEmailInput");
    const currentPasswordInput = document.getElementById("profileCurrentPasswordInput");
    const newPasswordInput = document.getElementById("profileNewPasswordInput");
    const confirmPasswordInput = document.getElementById("profileConfirmPasswordInput");

    let profile = sessionUser;
    try {
      const payload = await apiFetch("/users/me");
      profile = payload.user;
    } catch {
      // Keep session user fallback.
    }

    if (nameInput) {
      nameInput.value = profile.display_name || profile.username || "";
    }
    if (usernameInput) {
      usernameInput.value = profile.username || "";
    }
    if (emailInput) {
      emailInput.value = profile.email || "";
    }
    const isGoogle = profile.auth_provider === "google";
    if (isGoogle) {
      if (usernameInput) usernameInput.disabled = true;
      if (emailInput) emailInput.disabled = true;
      if (currentPasswordInput) currentPasswordInput.disabled = true;
      if (newPasswordInput) newPasswordInput.disabled = true;
      if (confirmPasswordInput) confirmPasswordInput.disabled = true;
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (errorNode) {
        errorNode.textContent = "";
        errorNode.classList.add("hidden");
      }

      const displayName = nameInput?.value?.trim() || "";
      const username = usernameInput?.value?.trim() || "";
      const email = emailInput?.value?.trim() || "";
      const currentPassword = currentPasswordInput?.value || "";
      const newPassword = newPasswordInput?.value || "";
      const confirmPassword = confirmPasswordInput?.value || "";

      if (newPassword && newPassword !== confirmPassword) {
        if (errorNode) {
          errorNode.textContent = t("auth_password_mismatch");
          errorNode.classList.remove("hidden");
          return;
        }
      }

      const payload = {};
      if (displayName) {
        payload.display_name = displayName;
      }
      if (username && username !== profile.username) {
        payload.username = username;
      }
      if (email !== (profile.email || "")) {
        payload.email = email;
      }
      if (newPassword) {
        payload.current_password = currentPassword;
        payload.new_password = newPassword;
      } else if (payload.username || payload.email) {
        payload.current_password = currentPassword;
      }

      try {
        const response = await apiFetch("/users/me", {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        profile = response.user;
        window.dispatchEvent(new CustomEvent("cipherline:userchange", { detail: { user: response.user } }));
        if (currentPasswordInput) currentPasswordInput.value = "";
        if (newPasswordInput) newPasswordInput.value = "";
        if (confirmPasswordInput) confirmPasswordInput.value = "";
        if (nameInput) nameInput.value = profile.display_name || profile.username || "";
        if (usernameInput) usernameInput.value = profile.username || "";
        if (emailInput) emailInput.value = profile.email || "";
      } catch (error) {
        if (errorNode) {
          errorNode.textContent = error.message;
          errorNode.classList.remove("hidden");
        }
      }
    });
  }

  function setDocumentTitle(unreadCount = 0) {
    const titleElement = document.querySelector("title");
    const baseTitle = titleElement?.dataset.i18n ? t(titleElement.dataset.i18n) : document.title.replace(/^\(\d+\)\s*/, "");
    document.title = unreadCount > 0 ? `(${unreadCount}) ${baseTitle}` : baseTitle;
  }

  async function ensureNotificationPermission() {
    if (typeof Notification === "undefined") {
      return "denied";
    }
    if (Notification.permission !== "default") {
      return Notification.permission;
    }
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }

  function notify({ title, body, tag, icon, href }) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return null;
    }
    const notification = new Notification(title, {
      body,
      tag,
      icon,
      badge: icon,
      renotify: true,
    });
    notification.onclick = () => {
      window.focus();
      if (href) {
        window.location.href = href;
      }
      notification.close();
    };
    return notification;
  }

  async function playNotificationSound() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      return false;
    }
    try {
      if (!notificationAudioContext) {
        notificationAudioContext = new AudioContextClass();
      }
      if (notificationAudioContext.state === "suspended") {
        await notificationAudioContext.resume();
      }

      const oscillator = notificationAudioContext.createOscillator();
      const gainNode = notificationAudioContext.createGain();
      const startAt = notificationAudioContext.currentTime;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, startAt);
      oscillator.frequency.setValueAtTime(660, startAt + 0.12);

      gainNode.gain.setValueAtTime(0.0001, startAt);
      gainNode.gain.exponentialRampToValueAtTime(0.08, startAt + 0.01);
      gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);

      oscillator.connect(gainNode);
      gainNode.connect(notificationAudioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.24);
      return true;
    } catch {
      return false;
    }
  }

  function getNotificationState() {
    try {
      const raw = localStorage.getItem(DM_NOTIFICATION_STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function saveNotificationState(state) {
    localStorage.setItem(DM_NOTIFICATION_STATE_KEY, JSON.stringify(state));
  }

  function rememberDirectMessageActivity(conversationId, createdAt, userId = dmNotificationUserId) {
    if (!conversationId || !createdAt || !userId) {
      return;
    }
    const state = getNotificationState();
    const userState = state[userId] && typeof state[userId] === "object" ? state[userId] : {};
    const current = String(userState[conversationId] || "");
    if (!current || createdAt > current) {
      userState[conversationId] = createdAt;
      state[userId] = userState;
      saveNotificationState(state);
    }
  }

  function stopGlobalDirectMessageWatcher() {
    if (dmNotificationReconnectTimer) {
      window.clearTimeout(dmNotificationReconnectTimer);
      dmNotificationReconnectTimer = 0;
    }
    if (dmNotificationSocket) {
      dmNotificationSocket.close();
      dmNotificationSocket = null;
    }
    dmNotificationUserId = "";
  }

  function handleDirectMessageNotificationEvent(payload) {
    if (!payload || payload.type !== "dm_notification") {
      return;
    }
    const conversationId = payload.other_user_id || "";
    const message = payload.message || {};
    const createdAt = String(message.created_at || "");
    if (!conversationId || !createdAt || message.user_id === dmNotificationUserId) {
      return;
    }

    const state = getNotificationState();
    const userState = state[dmNotificationUserId] && typeof state[dmNotificationUserId] === "object" ? state[dmNotificationUserId] : {};
    const seenAt = String(userState[conversationId] || "");
    const activeConversationId = getActiveDirectMessageUserId();
    const sameConversationOpen = window.location.pathname.startsWith("/dms") && activeConversationId === conversationId;
    const sameConversationFocused = window.location.pathname.startsWith("/dms")
      && activeConversationId === conversationId
      && document.visibilityState === "visible"
      && document.hasFocus();

    if (createdAt <= seenAt) {
      return;
    }

    userState[conversationId] = createdAt;
    state[dmNotificationUserId] = userState;
    saveNotificationState(state);

    if (sameConversationOpen || sameConversationFocused) {
      return;
    }

    const attachments = Array.isArray(message.attachments)
      ? message.attachments
      : (message.attachment ? [message.attachment] : []);

    notify({
      title: payload.username || t("state_active_direct"),
      body: (message.content || "").trim()
        || attachments[0]?.name
        || t("state_attachment_file"),
      tag: `dm-global:${conversationId}`,
      icon: payload.avatar_url || "",
      href: "/dms",
    });
    void playNotificationSound();
  }

  function connectGlobalDirectMessageWatcher() {
    if (!dmNotificationUserId || !getToken() || window.location.pathname === "/login") {
      return;
    }
    if (dmNotificationReconnectTimer) {
      window.clearTimeout(dmNotificationReconnectTimer);
      dmNotificationReconnectTimer = 0;
    }
    if (dmNotificationSocket && (dmNotificationSocket.readyState === WebSocket.OPEN || dmNotificationSocket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const token = encodeURIComponent(getToken());
    const endpoint = `${getDefaultSocketEndpoint()}/notifications?token=${token}`;
    dmNotificationSocket = new WebSocket(endpoint);

    dmNotificationSocket.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleDirectMessageNotificationEvent(payload);
      } catch {
        // Ignore malformed notification payloads.
      }
    });

    dmNotificationSocket.addEventListener("open", () => {
      dmNotificationSocket?.send("ready");
    });

    dmNotificationSocket.addEventListener("close", (event) => {
      const code = event?.code;
      const reason = String(event?.reason || "");
      const looksLikeInvalidSession = code === 1008 || reason.toLowerCase().includes("invalid session");
      dmNotificationSocket = null;

      if (looksLikeInvalidSession) {
        clearToken();
        window.location.href = "/login";
        return;
      }

      if (!dmNotificationUserId || !getToken()) {
        return;
      }
      dmNotificationReconnectTimer = window.setTimeout(() => {
        dmNotificationReconnectTimer = 0;
        connectGlobalDirectMessageWatcher();
      }, 1500);
    });

    dmNotificationSocket.addEventListener("error", () => {
      dmNotificationSocket?.close();
    });
  }

  function startGlobalDirectMessageWatcher(user) {
    if (!user?.id || window.location.pathname === "/login") {
      return;
    }
    if (dmNotificationUserId === user.id && dmNotificationSocket) {
      return;
    }

    stopGlobalDirectMessageWatcher();
    dmNotificationUserId = user.id;
    connectGlobalDirectMessageWatcher();
  }

  function getDefaultSocketEndpoint() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  function formatTime(value) {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  function formatFileSize(value) {
    const size = Number(value || 0);
    if (size < 1024) {
      return `${size} B`;
    }
    if (size < 1024 * 1024) {
      return `${(size / 1024).toFixed(1)} KB`;
    }
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function getInitials(value) {
    const words = String(value || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      return "?";
    }
    return words.slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("");
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
    return bytesToBase64(xorBytes(new TextEncoder().encode(text), key));
  }

  function base64ToTextWithXor(base64Text, key) {
    return new TextDecoder().decode(xorBytes(base64ToBytes(base64Text), key));
  }

  function create3xNGrid(text) {
    const rows = 3;
    const columns = text ? Math.ceil(text.length / rows) : 1;
    const grid = Array.from({ length: rows }, () => Array.from({ length: columns }, () => ""));
    let index = 0;
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        grid[row][column] = index < text.length ? text[index++] : "\0";
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
            grid[row][column] = diagonalText[index++];
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
    const result = [];
    let counter = 0;
    for (const char of text) {
      result.push(char);
      counter += 1;z
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
    validateNoiseSymbol(noiseSymbol);
    const result = [];
    let counter = 0;
    for (const char of text) {
      if (counter === interval) {
        if (char !== noiseSymbol) {
          throw new Error("Invalid encoded text.");
        }
        counter = 0;
        continue;
      }
      result.push(char);
      counter += 1;
    }
    return result.join("");
  }

  function encryptMessage(text, key) {
    const base64Xor = textToBase64WithXor(text, key);
    const realLength = base64Xor.length;
    const { grid, rows, columns } = create3xNGrid(base64Xor);
    const diagonal = readGridDiagonally(grid, rows, columns, realLength);
    const withNoise = insertNoiseSymbols(diagonal);
    return `${columns}|${DEFAULT_NOISE_INTERVAL}|${DEFAULT_NOISE_SYMBOL.codePointAt(0)}|${realLength}:${withNoise}`;
  }

  function decryptMessage(encodedText, key) {
    const [header, payload] = encodedText.split(/:(.*)/s, 2);
    const parts = header.split("|");
    const rows = 3;
    const columns = Number(parts[0]);
    const interval = Number(parts[1]);
    const noiseSymbol = String.fromCodePoint(Number(parts[2]));
    const realLength = Number(parts[3]);
    const diagonal = parts.length > 1 ? removeNoiseByInterval(payload, interval, noiseSymbol) : removeLegacyNoiseSymbols(payload);
    const grid = rebuildGridFromDiagonal(diagonal, rows, columns, realLength);
    const base64Text = readGridByRows(grid, rows, columns).replaceAll("\0", "");
    return base64ToTextWithXor(base64Text, key);
  }

  return {
    apiFetch,
    requireSession,
    setToken,
    getToken,
    clearToken,
    getLanguage,
    setLanguage,
    t,
    initLanguage,
    applyTranslations,
    registerServiceWorker,
    getActiveServerId,
    setActiveServerId,
    getActiveDirectMessageUserId,
    setActiveDirectMessageUserId,
    logout,
    initTheme,
    initSidebarToggle,
    renderSidebar,
    setDocumentTitle,
    ensureNotificationPermission,
    notify,
    playNotificationSound,
    rememberDirectMessageActivity,
    getDefaultSocketEndpoint,
    formatTime,
    formatFileSize,
    escapeHtml,
    getInitials,
    encryptMessage,
    decryptMessage,
  };
})();
