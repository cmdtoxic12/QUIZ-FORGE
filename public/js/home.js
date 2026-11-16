const authLinks = document.getElementById("authLinks");
const userEmail = document.getElementById("userEmail");
const logoutBtn = document.getElementById("logoutBtn");
const myQuizzes = document.getElementById("myQuizzes");
const myQuizzesNav = document.getElementById("myQuizzesNav");
const authNotice = document.getElementById("authNotice");
const engineStatus = document.getElementById("engineStatus");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const signedInUser = Auth.getUser();
if (Auth.getToken() && signedInUser?.email) {
  authLinks.classList.add("hidden");
  userEmail.textContent = signedInUser.email;
  userEmail.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  myQuizzes.classList.remove("hidden");
  myQuizzesNav.classList.remove("hidden");
  logoutBtn.onclick = Auth.logout;
  loadMyQuizzes();
  authNotice.classList.add("hidden");
} else {
  authNotice.classList.remove("hidden");
}

fetch("/api/health")
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (!data?.engine) return;
    const labels = { local: "Local quiz engine ready", gemini: "Gemini quiz engine ready", openai: "OpenAI quiz engine ready" };
    engineStatus.textContent = labels[data.engine] || "Quiz engine ready";
  })
  .catch(() => {});
const SAMPLE = `Photosynthesis is the process by which green plants convert light energy into chemical energy stored in glucose. The reaction takes place inside chloroplasts, organelles that contain the green pigment chlorophyll.
Chlorophyll absorbs light most strongly in the blue and red parts of the spectrum, which is why leaves appear green to the human eye.
The light-dependent reactions occur in the thylakoid membranes and split water molecules, releasing oxygen as a by-product. Roughly 330 billion tonnes of oxygen are produced by photosynthesis every year.
The Calvin cycle is a light-independent stage that fixes carbon dioxide into sugar using the enzyme RuBisCO, widely believed to be the most abundant protein on Earth.
Melvin Calvin received the Nobel Prize in Chemistry in 1961 for mapping this carbon fixation pathway.
Rates of photosynthesis increase with light intensity until a plateau is reached, after which carbon dioxide concentration or temperature becomes the limiting factor.`;

const SUPPORTED_EXTENSIONS = [
  ".pdf", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".txt", ".md",
  ".markdown", ".csv", ".tsv", ".json", ".html", ".htm", ".xml",
  ".yml", ".yaml", ".srt", ".tex", ".log", ".rtf",
];
const MAX_TOTAL_FILE_BYTES = 24 * 1024 * 1024;

const files = [];
let difficulty = "mixed";
let loading = false;

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

function difficultyLabel(value) {
  return ({ easy: "Warm-up", mixed: "Balanced", hard: "Advanced" })[value] || "Balanced";
}

function addFiles(list) {
  const errors = [];
  for (const f of list) {
    const ext = `.${f.name.split(".").pop()}`.toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      errors.push(`${f.name}: unsupported file type.`);
      continue;
    }
    if (f.size > 12 * 1024 * 1024) {
      errors.push(`${f.name}: larger than the 12 MB limit.`);
      continue;
    }
    if (files.some((x) => x.name === f.name && x.size === f.size)) continue;
    if (files.length >= 5) {
      errors.push("You can add up to 5 files.");
      break;
    }
    const currentBytes = files.reduce((total, file) => total + file.size, 0);
    if (currentBytes + f.size > MAX_TOTAL_FILE_BYTES) {
      errors.push("Combined file size cannot exceed 24 MB.");
      continue;
    }
    files.push(f);
  }
  renderFiles();
  errorBox.textContent = errors.join(" ");
  errorBox.classList.toggle("hidden", errors.length === 0);
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
    document.querySelectorAll(".diff-btn").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
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

  if (!Auth.getToken()) {
    authNotice.classList.remove("hidden");
    authNotice.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "center" });
    authNotice.querySelector("a")?.focus({ preventScroll: true });
    return;
  }

  loading = true;
  genBtn.disabled = true;
  genBtn.setAttribute("aria-busy", "true");
  genBtn.innerHTML = `<span class="spinner" aria-hidden="true"></span>Generating your quiz…`;
  errorBox.classList.add("hidden");

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
    if (!res.ok || !data.code) {
      if (res.status === 401) authNotice.classList.remove("hidden");
      throw new Error(data.error || "Generation failed.");
    }
    window.location.href = `/play/${data.code}`;
  } catch (err) {
    errorBox.textContent = err.message || "Generation failed.";
    errorBox.classList.remove("hidden");
    loading = false;
    genBtn.disabled = false;
    genBtn.textContent = "🎮 Generate my quiz game";
    genBtn.removeAttribute("aria-busy");
  }
});

async function loadMyQuizzes() {
  try {
    const res = await fetch("/api/quizzes/mine", {
      headers: Auth.authHeaders(),
    });
    if (!res.ok) throw new Error("Could not load your quizzes.");
    const data = await res.json();
    const list = data.quizzes || [];
    const grid = document.getElementById("myQuizzesGrid");
    const empty = document.getElementById("myQuizzesEmpty");

    if (!list.length) {
      document.getElementById("myQuizzesGrid").innerHTML = "";
      empty.classList.remove("hidden");
      return;
    }
    empty.classList.add("hidden");

    grid.innerHTML = list
      .slice(0, 8)
      .map(
        (q) => `
      <a class="quiz-card glass" href="/play/${q.code}">
        <div class="diff">${difficultyLabel(q.difficulty || "mixed")}</div>
        <div class="title">${escapeHtml(q.title)}</div>
        <div class="meta">${q.questionCount || 0} questions · ${q.plays || 0} plays</div>
        <span class="play">Play →</span>
      </a>`,
      )
      .join("");
  } catch {
    const empty = document.getElementById("myQuizzesEmpty");
    empty.textContent = "Could not load your quizzes. Refresh the page to try again.";
    empty.classList.remove("hidden");
  }
}

async function loadRecent() {
  try {
    const res = await fetch("/api/quizzes");
    if (!res.ok) throw new Error("Could not load recent quizzes.");
    const data = await res.json();
    const list = data.quizzes || [];
    const grid = document.getElementById("recentGrid");
    const section = document.getElementById("recentSection");
    const status = document.getElementById("recentStatus");
    if (!list.length) {
      section.classList.add("hidden");
      return;
    }
    status.classList.add("hidden");
    grid.innerHTML = list
      .slice(0, 4)
      .map(
        (q) => `
      <a class="quiz-card glass" href="/play/${q.code}">
        <div class="diff">${difficultyLabel(q.difficulty || "mixed")}</div>
        <div class="title">${escapeHtml(q.title)}</div>
        <div class="meta">${q.questionCount} questions · ${q.plays || 0} plays</div>
        <span class="play">Play →</span>
      </a>`,
      )
      .join("");
  } catch {
    const status = document.getElementById("recentStatus");
    status.textContent = "Could not load recent quizzes. Refresh the page to try again.";
  }
}

loadRecent();
