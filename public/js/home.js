// QuizForge home — null-safe DOM binding
(async () => {
  try {
    const user = await Auth.requireLogin();
    if (!user) return;

    const emailEl = document.getElementById("userEmail");
    const logoutBtn = document.getElementById("logoutBtn");
    if (emailEl) emailEl.textContent = user.email || "";
    if (logoutBtn) logoutBtn.onclick = Auth.logout;

    loadMyQuizzes();
  } catch (err) {
    console.warn("Auth bootstrap failed:", err);
  }
})();

const SAMPLE = `Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose. The reaction takes place inside chloroplasts, organelles that contain the green pigment chlorophyll.
Chlorophyll absorbs light most strongly in the blue and red parts of the spectrum, which is why leaves appear green to the human eye.
The light-dependent reactions occur in the thylakoid membranes and split water molecules, releasing oxygen as a by-product. Roughly 330 billion tonnes of oxygen are produced by photosynthesis every year.
The Calvin cycle is a light-independent stage that fixes carbon dioxide into sugar using the enzyme RuBisCO, widely believed to be the most abundant protein on Earth.
Melvin Calvin received the Nobel Prize in Chemistry in 1961 for mapping this carbon fixation pathway.
Rates of photosynthesis increase with light intensity until a plateau is reached, after which carbon dioxide concentration or temperature becomes the limiting factor.`;

const STAGES = [
  "Reading your documents…",
  "Extracting key concepts…",
  "Ranking the juiciest facts…",
  "Writing tricky distractors…",
  "Balancing difficulty curve…",
  "Loading the arcade…",
];

const files = [];
let difficulty = "mixed";
let loading = false;
let stageIdx = 0;
let stageTimer = null;

const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const pasteToggle = document.getElementById("pasteToggle");
const pasteArea = document.getElementById("pasteArea");
const countInput = document.getElementById("count");
const countVal = document.getElementById("countVal");
const genBtn = document.getElementById("genBtn");
const errorBox = document.getElementById("errorBox");
const sampleBtn = document.getElementById("sampleBtn");
const genProgress = document.getElementById("genProgress");
const genProgressFill = document.getElementById("genProgressFill");
const genStages = document.getElementById("genStages");

function toast(message, type = "info", duration = 3200) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add("leaving");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function renderFiles() {
  if (!fileList) return;
  fileList.innerHTML = files
    .map(
      (f, i) => `
    <li class="file-item">
      <span>${f.name.toLowerCase().endsWith(".pdf") ? "📕" : /\.(png|jpe?g|webp)$/i.test(f.name) ? "🖼️" : "📘"}</span>
      <div class="meta">
        <div class="name">${escapeHtml(f.name)}</div>
        <div class="size">${formatSize(f.size)}</div>
      </div>
      <button type="button" data-i="${i}" aria-label="Remove ${escapeHtml(f.name)}">✕</button>
    </li>`,
    )
    .join("");
  fileList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      files.splice(Number(btn.dataset.i), 1);
      renderFiles();
      toast("File removed", "info", 1800);
    });
  });
}

function addFiles(list) {
  let added = 0;
  for (const f of list) {
    if (files.length >= 5) {
      toast("Maximum 5 files allowed", "error");
      break;
    }
    if (f.size > 12 * 1024 * 1024) {
      toast(`${f.name} is larger than 12 MB`, "error");
      continue;
    }
    if (!files.some((x) => x.name === f.name && x.size === f.size)) {
      files.push(f);
      added++;
    }
  }
  renderFiles();
  if (errorBox) errorBox.classList.add("hidden");
  if (added) toast(`${added} file${added > 1 ? "s" : ""} added`, "success", 2000);
}

function setProgressStage(idx) {
  stageIdx = idx;
  const pct = ((idx + 1) / STAGES.length) * 100;
  if (genProgressFill) genProgressFill.style.width = `${pct}%`;
  if (genStages) {
    genStages.querySelectorAll("li").forEach((li) => {
      const s = Number(li.dataset.stage);
      li.classList.remove("active", "done");
      if (s < idx) li.classList.add("done");
      else if (s === idx) li.classList.add("active");
    });
  }
  if (genBtn) genBtn.innerHTML = `<span class="spinner"></span>${STAGES[idx]}`;
}

// Only bind builder events when the home builder UI is present
if (dropzone && fileInput) {
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag");
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener("change", () => {
    if (fileInput.files) addFiles(fileInput.files);
    fileInput.value = "";
  });
}

if (pasteToggle && pasteArea) {
  pasteToggle.addEventListener("click", () => {
    pasteArea.classList.toggle("hidden");
    pasteToggle.textContent = pasteArea.classList.contains("hidden")
      ? "+ Or paste raw text / notes"
      : "− Hide text box";
  });
}

if (sampleBtn && pasteArea) {
  sampleBtn.addEventListener("click", () => {
    pasteArea.value = SAMPLE;
    pasteArea.classList.remove("hidden");
    if (pasteToggle) pasteToggle.textContent = "− Hide text box";
    if (errorBox) errorBox.classList.add("hidden");
    toast("Sample photosynthesis notes loaded", "success");
  });
}

if (countInput && countVal) {
  countInput.addEventListener("input", () => {
    countVal.textContent = countInput.value;
  });
}

document.querySelectorAll(".diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".diff-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    difficulty = btn.dataset.d;
  });
});

if (genBtn) {
  genBtn.addEventListener("click", async () => {
    if (loading) return;
    const pasted = (pasteArea && pasteArea.value.trim()) || "";
    if (!files.length && pasted.length < 200) {
      if (errorBox) {
        errorBox.textContent =
          "Add a document, or paste at least a couple of paragraphs of text.";
        errorBox.classList.remove("hidden");
      }
      toast("Need more content to forge a quiz", "error");
      return;
    }

    loading = true;
    stageIdx = 0;
    genBtn.disabled = true;
    if (genProgress) genProgress.classList.remove("hidden");
    setProgressStage(0);
    if (errorBox) errorBox.classList.add("hidden");

    stageTimer = setInterval(() => {
      if (stageIdx < STAGES.length - 1) {
        setProgressStage(stageIdx + 1);
      }
    }, 1200);

    try {
      const body = new FormData();
      files.forEach((f) => body.append("files", f));
      if (pasted) body.append("text", pasted);
      if (countInput) body.append("count", countInput.value);
      body.append("difficulty", difficulty);

      const res = await fetch("/api/quiz/generate", {
        method: "POST",
        headers: Auth.authHeaders(),
        body,
      });
      const data = await res.json();
      if (!res.ok || !data.code)
        throw new Error(data.error || "Generation failed.");

      setProgressStage(STAGES.length - 1);
      clearInterval(stageTimer);
      toast("Quiz forged! Launching…", "success", 1500);
      setTimeout(() => {
        window.location.href = `/play/${data.code}`;
      }, 600);
    } catch (err) {
      if (errorBox) {
        errorBox.textContent = err.message || "Generation failed.";
        errorBox.classList.remove("hidden");
      }
      toast(err.message || "Generation failed", "error");
      loading = false;
      genBtn.disabled = false;
      genBtn.textContent = "🎮 Generate my quiz game";
      if (genProgress) genProgress.classList.add("hidden");
      if (genProgressFill) genProgressFill.style.width = "0%";
      clearInterval(stageTimer);
    }
  });
}

async function loadMyQuizzes() {
  try {
    const res = await fetch("/api/quizzes/mine", {
      headers: Auth.authHeaders(),
    });
    const data = await res.json();
    const list = data.quizzes || [];
    const grid = document.getElementById("myQuizzesGrid");
    const empty = document.getElementById("myQuizzesEmpty");
    if (!grid) return;

    if (!list.length) {
      if (empty) empty.classList.remove("hidden");
      return;
    }

    if (empty) empty.classList.add("hidden");
    grid.innerHTML = list
      .slice(0, 8)
      .map(
        (q) => `
      <a class="quiz-card glass" href="/play/${q.code}">
        <div class="diff">${escapeHtml(q.difficulty || "mixed")}</div>
        <div class="title">${escapeHtml(q.title)}</div>
        <div class="meta">${q.questionCount || 0} questions · ${q.plays || 0} plays</div>
        <span class="play">Play →</span>
      </a>`,
      )
      .join("");
  } catch {
    /* ignore */
  }
}

async function loadRecent() {
  try {
    const res = await fetch("/api/quizzes");
    const data = await res.json();
    const list = data.quizzes || [];
    const grid = document.getElementById("recentGrid");
    const section = document.getElementById("recentSection");
    if (!grid) return;
    if (!list.length) {
      if (section) section.classList.add("hidden");
      return;
    }
    grid.innerHTML = list
      .slice(0, 4)
      .map(
        (q) => `
      <a class="quiz-card glass" href="/play/${q.code}">
        <div class="diff">${escapeHtml(q.difficulty || "mixed")}</div>
        <div class="title">${escapeHtml(q.title)}</div>
        <div class="meta">${q.questionCount} questions · ${q.plays || 0} plays</div>
        <span class="play">Play →</span>
      </a>`,
      )
      .join("");
  } catch {
    /* ignore */
  }
}

loadRecent();
