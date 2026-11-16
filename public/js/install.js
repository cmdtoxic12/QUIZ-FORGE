/**
 * QuizForge — floating PWA install button
 * Supports: Chromium (beforeinstallprompt), iOS Safari (manual steps),
 * already-installed detection, and dismiss persistence.
 */
(function () {
  const DISMISS_KEY = "qf-install-dismissed";
  const DISMISS_DAYS = 14;

  let deferredPrompt = null;

  function isStandalone() {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.matchMedia("(display-mode: fullscreen)").matches ||
      window.navigator.standalone === true // iOS
    );
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isAndroid() {
    return /android/i.test(navigator.userAgent);
  }

  function wasDismissed() {
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      const until = Number(raw);
      if (Date.now() < until) return true;
      localStorage.removeItem(DISMISS_KEY);
      return false;
    } catch {
      return false;
    }
  }

  function dismiss() {
    try {
      localStorage.setItem(
        DISMISS_KEY,
        String(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000)
      );
    } catch { /* ignore */ }
    hideFab();
  }

  function hideFab() {
    const fab = document.getElementById("pwaInstallFab");
    if (fab) fab.classList.add("hidden");
    const sheet = document.getElementById("pwaInstallSheet");
    if (sheet) sheet.classList.add("hidden");
  }

  function showFab() {
    const fab = document.getElementById("pwaInstallFab");
    if (fab) fab.classList.remove("hidden");
  }

  function ensureUI() {
    if (document.getElementById("pwaInstallFab")) return;

    const fab = document.createElement("button");
    fab.type = "button";
    fab.id = "pwaInstallFab";
    fab.className = "pwa-fab hidden";
    fab.setAttribute("aria-label", "Install QuizForge app");
    fab.innerHTML = `
      <span class="pwa-fab-icon" aria-hidden="true">⬇</span>
      <span class="pwa-fab-label">Install app</span>
    `;
    fab.addEventListener("click", onFabClick);
    document.body.appendChild(fab);

    const sheet = document.createElement("div");
    sheet.id = "pwaInstallSheet";
    sheet.className = "pwa-sheet hidden";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-labelledby", "pwaSheetTitle");
    sheet.innerHTML = `
      <div class="pwa-sheet-backdrop" data-close></div>
      <div class="pwa-sheet-card glass glow-ring">
        <button type="button" class="pwa-sheet-close" data-close aria-label="Close">✕</button>
        <div class="pwa-sheet-icon">📱</div>
        <h2 id="pwaSheetTitle">Install QuizForge</h2>
        <p class="pwa-sheet-sub">Add it to your home screen for quick access and offline play.</p>
        <div id="pwaSheetBody"></div>
        <div class="pwa-sheet-actions">
          <button type="button" class="btn btn-ghost" data-dismiss>Not now</button>
          <button type="button" class="pwa-install-btn" id="pwaSheetInstall">Install</button>
        </div>
      </div>
    `;
    sheet.querySelectorAll("[data-close]").forEach((el) => {
      el.addEventListener("click", () => closeSheetOnly());
    });
    sheet.querySelectorAll("[data-dismiss]").forEach((el) => {
      el.addEventListener("click", () => dismiss());
    });
    sheet.querySelector("#pwaSheetInstall")?.addEventListener("click", onInstallClick);
    document.body.appendChild(sheet);
  }

  function openSheet() {
    ensureUI();
    const sheet = document.getElementById("pwaInstallSheet");
    const body = document.getElementById("pwaSheetBody");
    const installBtn = document.getElementById("pwaSheetInstall");
    if (!sheet || !body) return;

    if (deferredPrompt) {
      body.innerHTML = `<p class="pwa-steps">One tap installs QuizForge like a native app on this device.</p>`;
      if (installBtn) {
        installBtn.classList.remove("hidden");
        installBtn.textContent = "Install";
      }
    } else if (isIOS()) {
      body.innerHTML = `
        <ol class="pwa-steps">
          <li>Tap the <strong>Share</strong> button <span class="pwa-ios-share">⎋</span> in Safari</li>
          <li>Scroll and tap <strong>Add to Home Screen</strong></li>
          <li>Tap <strong>Add</strong> to confirm</li>
        </ol>
        <p class="pwa-hint">Works best in Safari on iPhone &amp; iPad.</p>
      `;
      if (installBtn) installBtn.classList.add("hidden");
    } else if (isAndroid()) {
      body.innerHTML = `
        <ol class="pwa-steps">
          <li>Open the browser menu (⋮)</li>
          <li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong></li>
          <li>Confirm the install</li>
        </ol>
      `;
      if (installBtn) installBtn.classList.add("hidden");
    } else {
      body.innerHTML = `
        <ol class="pwa-steps">
          <li>Open the browser menu</li>
          <li>Choose <strong>Install QuizForge</strong> or <strong>Apps → Install this site as an app</strong></li>
          <li>On desktop Chrome/Edge: look for the install icon in the address bar</li>
        </ol>
      `;
      if (installBtn) installBtn.classList.add("hidden");
    }

    sheet.classList.remove("hidden");
  }

  function closeSheetOnly() {
    const sheet = document.getElementById("pwaInstallSheet");
    if (sheet) sheet.classList.add("hidden");
  }

  async function onInstallClick() {
    if (!deferredPrompt) {
      openSheet();
      return;
    }
    try {
      deferredPrompt.prompt();
      const result = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (result && result.outcome === "accepted") {
        hideFab();
        closeSheetOnly();
        try {
          const t = document.getElementById("toastContainer");
          if (t) {
            const el = document.createElement("div");
            el.className = "toast success";
            el.textContent = "QuizForge installed!";
            t.appendChild(el);
            setTimeout(() => el.remove(), 3000);
          }
        } catch { /* ignore */ }
      } else {
        closeSheetOnly();
      }
    } catch {
      openSheet();
    }
  }

  function onFabClick() {
    if (deferredPrompt) {
      onInstallClick();
    } else {
      openSheet();
    }
  }

  function maybeShow() {
    if (isStandalone()) {
      hideFab();
      return;
    }
    if (wasDismissed()) return;
    ensureUI();
    // Show fab after a short delay so it doesn't compete with first paint
    setTimeout(showFab, 1800);
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (!wasDismissed() && !isStandalone()) {
      ensureUI();
      showFab();
    }
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    hideFab();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeShow);
  } else {
    maybeShow();
  }
})();
