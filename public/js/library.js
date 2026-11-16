function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function difficultyLabel(value) {
  return ({ easy: "Warm-up", mixed: "Balanced", hard: "Advanced" })[value] || "Balanced";
}

async function load() {
  const grid = document.getElementById("libGrid");
  const empty = document.getElementById("empty");
  const status = document.getElementById("libraryStatus");
  const search = document.getElementById("librarySearch");
  const difficulty = document.getElementById("difficultyFilter");
  try {
    const res = await fetch("/api/quizzes");
    if (!res.ok) throw new Error("Could not load the quiz library.");
    const data = await res.json();
    const list = data.quizzes || [];
    status.classList.add("hidden");

    if (!list.length) {
      empty.innerHTML = 'No quizzes yet. <a href="/">Forge one →</a>';
      empty.classList.remove("hidden");
      return;
    }

    function render() {
      const query = search.value.trim().toLowerCase();
      const selectedDifficulty = difficulty.value;
      const matches = list.filter((q) => {
        const text = [q.title, q.subtitle, ...(q.keywords || [])].join(" ").toLowerCase();
        return (!query || text.includes(query)) && (selectedDifficulty === "all" || (q.difficulty || "mixed") === selectedDifficulty);
      });

      if (!matches.length) {
        grid.innerHTML = "";
        empty.textContent = list.length ? "No quizzes match those filters. Try a different search." : "No quizzes yet. Forge one to start the library.";
        empty.classList.remove("hidden");
        return;
      }
      empty.classList.add("hidden");
      grid.innerHTML = matches
        .map(
          (q) => `
        <a class="quiz-card glass" href="/play/${encodeURIComponent(q.code)}">
          <div class="diff">${difficultyLabel(q.difficulty || "mixed")}</div>
          <div class="title">${escapeHtml(q.title)}</div>
          <div class="meta">${q.questionCount} questions · ${q.plays || 0} plays · ${escapeHtml(q.engine || "")}</div>
          <span class="play">Play →</span>
        </a>`
        )
        .join("");
    }

    search.addEventListener("input", render);
    difficulty.addEventListener("change", render);
    render();
  } catch {
    status.textContent = "Could not load the library. Refresh the page to try again.";
  }
}

load();
