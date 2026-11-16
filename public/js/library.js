function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

let allQuizzes = [];
let filterDiff = "all";
let searchQuery = "";
let sortBy = "newest";

function applyFilters() {
  const grid = document.getElementById("libGrid");
  const empty = document.getElementById("empty");
  const countEl = document.getElementById("libCount");

  let list = [...allQuizzes];

  if (filterDiff !== "all") {
    list = list.filter((q) => (q.difficulty || "mixed") === filterDiff);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter((item) => (item.title || "").toLowerCase().includes(q));
  }

  if (sortBy === "plays") {
    list.sort((a, b) => (b.plays || 0) - (a.plays || 0));
  } else if (sortBy === "title") {
    list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  } else {
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  if (countEl) {
    countEl.textContent = list.length
      ? `${list.length} quiz${list.length === 1 ? "" : "zes"}`
      : "";
  }

  if (!list.length) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  grid.innerHTML = list
    .map(
      (q) => `
    <a class="quiz-card glass" href="/play/${q.code}">
      <div class="diff">${escapeHtml(q.difficulty || "mixed")}</div>
      <div class="title">${escapeHtml(q.title)}</div>
      <div class="meta">${q.questionCount || 0} questions · ${q.plays || 0} plays</div>
      <span class="play">Play →</span>
    </a>`
    )
    .join("");
}

async function load() {
  const empty = document.getElementById("empty");
  try {
    const res = await fetch("/api/quizzes");
    const data = await res.json();
    allQuizzes = data.quizzes || [];
    applyFilters();
  } catch {
    empty.textContent = "Could not load library.";
    empty.classList.remove("hidden");
  }
}

document.getElementById("libSearch")?.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  applyFilters();
});

document.querySelectorAll(".filter-chip").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-chip").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    filterDiff = btn.dataset.diff;
    applyFilters();
  });
});

document.getElementById("libSort")?.addEventListener("change", (e) => {
  sortBy = e.target.value;
  applyFilters();
});

load();
