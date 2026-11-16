function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

async function load() {
  const grid = document.getElementById("libGrid");
  const empty = document.getElementById("empty");
  try {
    const res = await fetch("/api/quizzes");
    const data = await res.json();
    const list = data.quizzes || [];
    if (!list.length) {
      empty.classList.remove("hidden");
      return;
    }
    grid.innerHTML = list
      .map(
        (q) => `
      <a class="quiz-card glass" href="/play/${q.code}">
        <div class="diff">${escapeHtml(q.difficulty || "mixed")}</div>
        <div class="title">${escapeHtml(q.title)}</div>
        <div class="meta">${q.questionCount} questions · ${q.plays || 0} plays · ${escapeHtml(q.engine || "")}</div>
        <span class="play">Play →</span>
      </a>`
      )
      .join("");
  } catch {
    empty.textContent = "Could not load library.";
    empty.classList.remove("hidden");
  }
}

load();
