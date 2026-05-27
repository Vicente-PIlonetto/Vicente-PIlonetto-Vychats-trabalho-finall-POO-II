const App = window.CipherlineApp;

let currentUser = null;

App.initLanguage();
App.initTheme();
App.registerServiceWorker();
bootstrap();

window.addEventListener("cipherline:languagechange", () => {
  if (currentUser) {
    App.renderSidebar({ activePage: "settings", user: currentUser });
  }
});
window.addEventListener("cipherline:userchange", (event) => {
  currentUser = event.detail.user;
  App.renderSidebar({ activePage: "settings", user: currentUser });
});

async function bootstrap() {
  currentUser = await App.requireSession();
  if (!currentUser) {
    return;
  }
  App.renderSidebar({ activePage: "settings", user: currentUser });
}
