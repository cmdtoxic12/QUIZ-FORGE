(function () {
  const KEY = "qf-theme";
  const root = document.documentElement;

  function apply(theme) {
    if (theme === "light") {
      root.setAttribute("data-theme", "light");
    } else {
      root.removeAttribute("data-theme");
    }
    const btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = theme === "light" ? "☀️" : "🌙";
      btn.setAttribute("aria-label", theme === "light" ? "Switch to dark mode" : "Switch to light mode");
    }
  }

  let theme = localStorage.getItem(KEY);
  if (!theme) {
    theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  apply(theme);

  document.addEventListener("DOMContentLoaded", () => {
    apply(theme);
    const btn = document.getElementById("themeToggle");
    if (!btn) return;
    btn.addEventListener("click", () => {
      theme = theme === "light" ? "dark" : "light";
      localStorage.setItem(KEY, theme);
      apply(theme);
    });
  });
})();
