// Require login
(async () => {
  const user = await Auth.requireLogin();
  if (!user) return;

  document.getElementById("userEmail").textContent = user.email;
  document.getElementById("logoutBtn").onclick = Auth.logout;

  // Load My Quizzes
  loadMyQuizzes();
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

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderFiles() {
  fileList.innerHTML = files
    .map(
      (f, i) => `
    <li class="file-item">
      <span>${f.name.endsWith(".pdf") ? "📕" : "📘"}</span>
      <div class="meta">
        <div class="name">${escapeHtml(f.name)}</div>
        <div class="size">${formatSize(f.size)}</div>
      </div>
      <button type="button" data-i="${i}" aria-label="Remove">✕</button>
    </li>`,
    )
    .join("");
  fileList.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      files.splice(Number(btn.dataset.i), 1);
      renderFiles();
    });
  });
}

function escapeHtml(s) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function addFiles(list) {
  for (const f of list) {
    if (files.length >= 5) break;
    if (!files.some((x) => x.name === f.name && x.size === f.size))
      files.push(f);
  }
  renderFiles();
  errorBox.classList.add("hidden");
}

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

pasteToggle.addEventListener("click", () => {
  pasteArea.classList.toggle("hidden");
  pasteToggle.textContent = pasteArea.classList.contains("hidden")
    ? "+ Or paste raw text / notes"
    : "− Hide text box";
});

sampleBtn.addEventListener("click", () => {
  pasteArea.value = SAMPLE;
  pasteArea.classList.remove("hidden");
  pasteToggle.textContent = "− Hide text box";
  errorBox.classList.add("hidden");
});

countInput.addEventListener("input", () => {
  countVal.textContent = countInput.value;
});

document.querySelectorAll(".diff-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".diff-btn")
      .forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    difficulty = btn.dataset.d;
  });
});

genBtn.addEventListener("click", async () => {
  if (loading) return;
  const pasted = pasteArea.value.trim();
  if (!files.length && pasted.length < 200) {
    errorBox.textContent =
      "Add a document, or paste at least a couple of paragraphs of text.";
    errorBox.classList.remove("hidden");
    return;
  }

  loading = true;
  stageIdx = 0;
  genBtn.disabled = true;
  genBtn.innerHTML = `<span class="spinner"></span>${STAGES[0]}`;
  errorBox.classList.add("hidden");
  stageTimer = setInterval(() => {
    stageIdx = Math.min(stageIdx + 1, STAGES.length - 1);
    genBtn.innerHTML = `<span class="spinner"></span>${STAGES[stageIdx]}`;
  }, 1100);

  try {
    const body = new FormData();
    files.forEach((f) => body.append("files", f));
    if (pasted) body.append("text", pasted);
    body.append("count", countInput.value);
    body.append("difficulty", difficulty);

    const res = await fetch("/api/quiz/generate", {
      method: "POST",
      headers: Auth.authHeaders(),
      body,
    });
    const data = await res.json();
    if (!res.ok || !data.code)
      throw new Error(data.error || "Generation failed.");
    window.location.href = `/play/${data.code}`;
  } catch (err) {
    errorBox.textContent = err.message || "Generation failed.";
    errorBox.classList.remove("hidden");
    loading = false;
    genBtn.disabled = false;
    genBtn.textContent = "🎮 Generate my quiz game";
    clearInterval(stageTimer);
  }
});

async function loadMyQuizzes() {
  try {
    const res = await fetch("/api/quizzes/mine", {
      headers: Auth.authHeaders(),
    });
    const data = await res.json();
    const list = data.quizzes || [];
    const grid = document.getElementById("myQuizzesGrid");
    const empty = document.getElementById("myQuizzesEmpty");

    if (!list.length) {
      empty.classList.remove("hidden");
      return;
    }

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
    if (!list.length) {
      section.classList.add("hidden");
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
