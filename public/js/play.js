const LETTERS = ["A", "B", "C", "D", "E"];
const TYPE_LABEL = {
  "multiple-choice": "Definition",
  "true-false": "Fact check",
  "fill-blank": "Fill the blank",
  "which-true": "Spot the truth",
};

function engineLabel(engine) {
  if (engine?.startsWith("gemini:")) {
    return { text: "Gemini AI • Source-grounded", className: "gemini" };
  }

  if (engine?.startsWith("openai:")) {
    return { text: "OpenAI AI • Source-grounded", className: "openai" };
  }

  return { text: "Local quiz engine • Offline", className: "local" };
}

function rankFor(accuracy) {
  if (accuracy >= 0.95) return { title: "Legendary Scholar", emoji: "👑" };
  if (accuracy >= 0.8) return { title: "Document Whisperer", emoji: "🧠" };
  if (accuracy >= 0.6) return { title: "Solid Skimmer", emoji: "📗" };
  if (accuracy >= 0.4) return { title: "Casual Reader", emoji: "🙂" };
  return { title: "Needs a Re-read", emoji: "🫠" };
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function renderPrompt(prompt) {
  return escapeHtml(prompt).replace(
    /(＿+)/g,
    '<span class="blank">blank</span>',
  );
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function dealQuestions(source) {
  return shuffle(source).map((q) => {
    const correctText = q.options.find((o) => o.id === q.correctOptionId)?.text;
    const shuffled = shuffle(q.options).map((o, i) => ({ ...o, id: `o${i}` }));
    const matched = shuffled.find((o) => o.text === correctText);
    return {
      ...q,
      options: shuffled,
      correctOptionId: matched ? matched.id : shuffled[0]?.id,
    };
  });
}

function confetti() {
  const colors = ["#a78bfa", "#22d3ee", "#f472b6", "#a3e635", "#fbbf24"];
  for (let i = 0; i < 48; i++) {
    const el = document.createElement("div");
    el.className = "confetti-piece";
    el.style.left = `${Math.random() * 100}vw`;
    el.style.background = colors[i % colors.length];
    el.style.setProperty("--dx", `${(Math.random() - 0.5) * 200}px`);
    el.style.setProperty("--dur", `${2 + Math.random() * 2}s`);
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4500);
  }
}

const code = window.location.pathname.split("/").pop()?.toUpperCase();
const app = document.getElementById("app");

let quiz = null;
let questions = [];
let phase = "intro";
let index = 0;
let chosen = null;
let score = 0;
let streak = 0;
let maxStreak = 0;
let answers = [];
let timeLeft = 0;
let eliminated = [];
let hintOpen = false;
let lifelines = { fifty: 2, hint: 2, skip: 1 };
let startedAt = 0;
let questionStart = 0;
let timerId = null;

async function loadQuiz() {
  try {
    const res = await fetch(`/api/quiz/${code}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Not found");
    quiz = data;
    questions = dealQuestions(data.questions || []);
    render();
  } catch (err) {
    app.innerHTML = `
      <div class="glass glow-ring intro-card">
        <h1>Quiz not found</h1>
        <p style="color:rgba(255,255,255,0.6);margin-top:0.75rem">${escapeHtml(err.message)}</p>
        <a href="/" class="start-btn" style="display:inline-block;margin-top:1.5rem;text-decoration:none">Forge a new one</a>
      </div>`;
  }
}

function beginQuestion(i) {
  chosen = null;
  eliminated = [];
  hintOpen = false;
  timeLeft = questions[i].seconds * 1000;
  questionStart = Date.now();
  clearInterval(timerId);
  timerId = setInterval(() => {
    timeLeft = Math.max(0, timeLeft - 100);
    updateTimer();
    if (timeLeft <= 0) {
      clearInterval(timerId);
      submitAnswer(null);
    }
  }, 100);
}

function start() {
  startedAt = Date.now();
  phase = "playing";
  index = 0;
  beginQuestion(0);
  render();
}

function submitAnswer(optionId) {
  if (phase !== "playing") return;
  const q = questions[index];
  if (!q) return;
  clearInterval(timerId);
  const msUsed = Date.now() - questionStart;
  const correct = optionId !== null && optionId === q.correctOptionId;
  const fraction = Math.max(0, Math.min(1, timeLeft / (q.seconds * 1000)));
  const speed = correct ? Math.round(q.points * (0.55 + 0.45 * fraction)) : 0;
  const bonus = correct ? Math.min(streak, 6) * 25 : 0;
  const gained = speed + bonus;

  chosen = optionId;
  phase = "reveal";
  score += gained;
  streak = correct ? streak + 1 : 0;
  maxStreak = Math.max(maxStreak, streak);
  answers.push({
    questionId: q.id,
    chosenId: optionId,
    correct,
    points: gained,
    msUsed,
  });

  showPop(
    correct
      ? `+${gained}${bonus ? ` 🔥x${streak}` : ""}`
      : optionId
        ? "Missed!"
        : "Time!",
    correct,
  );
  render();
}

function next() {
  if (index + 1 >= questions.length) {
    phase = "results";
    const accuracy =
      answers.filter((a) => a.correct).length / Math.max(answers.length, 1);
    if (accuracy >= 0.7) confetti();
    render();
    return;
  }
  index += 1;
  phase = "playing";
  beginQuestion(index);
  render();
}

function useFifty() {
  if (lifelines.fifty <= 0 || phase !== "playing" || eliminated.length) return;
  const q = questions[index];
  const wrong = q.options.filter((o) => o.id !== q.correctOptionId);
  eliminated = wrong
    .slice(0, Math.max(1, q.options.length - 2))
    .map((o) => o.id);
  lifelines.fifty -= 1;
  render();
}

function useHint() {
  if (lifelines.hint <= 0 || phase !== "playing" || hintOpen) return;
  hintOpen = true;
  lifelines.hint -= 1;
  score = Math.max(0, score - 30);
  render();
}

function useSkip() {
  if (lifelines.skip <= 0 || phase !== "playing") return;
  clearInterval(timerId);
  answers.push({
    questionId: questions[index].id,
    chosenId: null,
    correct: false,
    points: 0,
    msUsed: 0,
  });
  lifelines.skip -= 1;
  streak = 0;
  if (index + 1 >= questions.length) {
    phase = "results";
    render();
  } else {
    index += 1;
    phase = "playing";
    beginQuestion(index);
    render();
  }
}

function showPop(text, good) {
  const el = document.createElement("div");
  el.className = `score-pop ${good ? "good" : "bad"}`;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function updateTimer() {
  const bar = document.getElementById("timerFill");
  const wrap = document.getElementById("timerBar");
  if (!bar || !wrap) return;
  const q = questions[index];
  const pct = (timeLeft / (q.seconds * 1000)) * 100;
  bar.style.width = `${pct}%`;
  wrap.classList.toggle("warn", pct < 40);
  wrap.classList.toggle("danger", pct < 20);
  const label = document.getElementById("timeLabel");
  if (label) label.textContent = `${Math.ceil(timeLeft / 1000)}s`;
}

function render() {
  if (!quiz) return;
  const engine = engineLabel(quiz.engine);
  if (phase === "intro") {
    const maxScore = questions.reduce((s, q) => s + q.points + 150, 0);
    app.innerHTML = `
      <div class="glass glow-ring intro-card">
        <div class="intro-icon">🎯</div>
        <p style="font-size:0.7rem;font-weight:900;text-transform:uppercase;letter-spacing:0.2em;color:#67e8f9">Quiz ready</p>
        <p class="engine-badge ${engine.className}">
  ${escapeHtml(engine.text)}
</p>
        <h1>${escapeHtml(quiz.title)}</h1>
        <p style="color:rgba(255,255,255,0.6);margin-top:0.75rem">${escapeHtml(quiz.subtitle || "")}</p>
        <div class="stat-row">
          <div class="stat"><div>❓</div><div class="val">${questions.length}</div><div class="lbl">Questions</div></div>
          <div class="stat"><div>🏆</div><div class="val">${maxScore}</div><div class="lbl">Max score</div></div>
          <div class="stat"><div>📚</div><div class="val">${(quiz.wordCount || 0).toLocaleString()}</div><div class="lbl">Source words</div></div>
        </div>
        ${
          (quiz.keywords || []).length
            ? `<div class="tags">${quiz.keywords
                .slice(0, 8)
                .map(
                  (k) =>
                    `<span class="tag">#${escapeHtml(k.replace(/\s+/g, ""))}</span>`,
                )
                .join("")}</div>`
            : ""
        }
        <button type="button" class="start-btn" id="startBtn">Start game →</button>
        <p style="margin-top:1rem;font-size:0.75rem;color:rgba(255,255,255,0.4)">Press Enter · Keys 1–4 to answer</p>
      </div>`;
    document.getElementById("startBtn").onclick = start;
    return;
  }

  if (phase === "playing" || phase === "reveal") {
    const q = questions[index];
    const pct =
      ((index + (phase === "reveal" ? 1 : 0)) / questions.length) * 100;
    const timerPct = (timeLeft / (q.seconds * 1000)) * 100;

    app.innerHTML = `
      <div class="hud">
        <div class="hud-left">
          <span>Q ${index + 1}/${questions.length}</span>
          <span style="color:var(--cyan)">★ ${score}</span>
          ${streak > 1 ? `<span style="color:var(--lime)">🔥 ${streak}</span>` : ""}
        </div>
        <div class="hud-right">
          <span id="timeLabel">${Math.ceil(timeLeft / 1000)}s</span>
        </div>
      </div>
      <div class="progress-bar"><div style="width:${pct}%"></div></div>
      <div class="timer-bar ${timerPct < 40 ? (timerPct < 20 ? "danger" : "warn") : ""}" id="timerBar">
        <div id="timerFill" style="width:${timerPct}%"></div>
      </div>
      <div class="glass glow-ring q-card" style="text-align:left">
        <span class="type-badge ${q.difficulty}">${TYPE_LABEL[q.type] || q.type} · ${q.difficulty}</span>
        <div class="prompt">${renderPrompt(q.prompt)}</div>
        <div class="options">
          ${q.options
            .map((o, i) => {
              let cls = "opt";
              if (eliminated.includes(o.id)) cls += " eliminated";
              if (phase === "reveal") {
                if (o.id === q.correctOptionId) cls += " correct";
                else if (o.id === chosen) cls += " wrong";
                else cls += " disabled";
              }
              return `<button type="button" class="${cls}" data-id="${o.id}" ${
                phase !== "playing" || eliminated.includes(o.id)
                  ? "disabled"
                  : ""
              }>
                <span class="letter">${LETTERS[i]}</span>
                <span>${escapeHtml(o.text)}</span>
              </button>`;
            })
            .join("")}
        </div>
        ${
          phase === "playing"
            ? `<div class="lifelines">
                <button type="button" class="life-btn" id="fiftyBtn" ${lifelines.fifty ? "" : "disabled"}>50/50 (${lifelines.fifty})</button>
                <button type="button" class="life-btn" id="hintBtn" ${lifelines.hint ? "" : "disabled"}>Hint (−30) (${lifelines.hint})</button>
                <button type="button" class="life-btn" id="skipBtn" ${lifelines.skip ? "" : "disabled"}>Skip (${lifelines.skip})</button>
              </div>
              ${hintOpen ? `<div class="hint-box">💡 ${escapeHtml(q.hint || "No hint")}</div>` : ""}`
            : `<div class="explain-box"><strong>Explanation:</strong> ${escapeHtml(q.explanation || "")}</div>
               <div style="text-align:center"><button type="button" class="next-btn" id="nextBtn">${
                 index + 1 >= questions.length
                   ? "See results →"
                   : "Next question →"
               }</button></div>`
        }
      </div>`;

    if (phase === "playing") {
      app.querySelectorAll(".opt").forEach((btn) => {
        btn.addEventListener("click", () => submitAnswer(btn.dataset.id));
      });
      document.getElementById("fiftyBtn")?.addEventListener("click", useFifty);
      document.getElementById("hintBtn")?.addEventListener("click", useHint);
      document.getElementById("skipBtn")?.addEventListener("click", useSkip);
    } else {
      document.getElementById("nextBtn")?.addEventListener("click", next);
    }
    return;
  }

  if (phase === "results") {
    const correctCount = answers.filter((a) => a.correct).length;
    const accuracy = answers.length ? correctCount / answers.length : 0;
    const rank = rankFor(accuracy);
    app.innerHTML = `
      <div class="glass glow-ring results-card">
        <div class="intro-icon">${rank.emoji}</div>
        <p style="font-size:0.7rem;font-weight:900;text-transform:uppercase;letter-spacing:0.15em;color:#67e8f9">Run complete</p>
        <h1>${escapeHtml(quiz.title)}</h1>
        <div class="rank-badge">${rank.emoji} ${rank.title}</div>
        <div class="stat-row" style="margin-top:1.5rem">
          <div class="stat"><div class="val">${score}</div><div class="lbl">Score</div></div>
          <div class="stat"><div class="val">${correctCount}/${questions.length}</div><div class="lbl">Correct</div></div>
          <div class="stat"><div class="val">${maxStreak}</div><div class="lbl">Best streak</div></div>
        </div>
        <div class="save-row">
          <input type="text" id="playerName" placeholder="Your name" maxlength="24" />
          <button type="button" id="saveBtn">Save to leaderboard</button>
        </div>
        <p id="saveMsg" style="margin-top:0.5rem;font-size:0.8rem;color:rgba(255,255,255,0.5)"></p>
        <div class="leaderboard" id="lb"></div>
        <div class="action-row">
          <button type="button" id="retryBtn">Play again</button>
          <button type="button" id="regenerateBtn">Generate new version</button>
          <button type="button" id="shareBtn">Copy link</button>
          <a href="/">Forge another</a>
          <a href="/library">Library</a>
        </div>
      </div>`;

    document.getElementById("retryBtn").onclick = () => {
      index = 0;
      score = 0;
      streak = 0;
      maxStreak = 0;
      answers = [];
      lifelines = { fifty: 2, hint: 2, skip: 1 };
      questions = dealQuestions(quiz.questions);
      start();
    };
    document.getElementById("shareBtn").onclick = async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        document.getElementById("shareBtn").textContent = "Copied!";
      } catch {
        /* ignore */
      }
    };
    document.getElementById("regenerateBtn").onclick = async () => {
      const btn = document.getElementById("regenerateBtn");
      btn.disabled = true;
      btn.textContent = "Generating…";
      try {
        const res = await fetch(`/api/quiz/${code}/regenerate`, {
          method: "POST",
        });
        const data = await res.json();
        if (!res.ok)
          throw new Error(data.error || "Could not generate a new version.");
        window.location.href = `/play/${data.code}`;
      } catch (error) {
        btn.disabled = false;
        btn.textContent = error.message || "Generate new version";
      }
    };
    document.getElementById("saveBtn").onclick = saveScore;
    loadLeaderboard();
  }
}

async function saveScore() {
  const btn = document.getElementById("saveBtn");
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    const res = await fetch(`/api/quiz/${code}/attempt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        playerName:
          document.getElementById("playerName").value.trim() || "Anonymous",
        score,
        correct: answers.filter((a) => a.correct).length,
        total: questions.length,
        maxStreak,
        durationMs: Date.now() - startedAt,
      }),
    });
    const data = await res.json();
    const msg = document.getElementById("saveMsg");
    msg.textContent = data.rank ? `Saved! Rank #${data.rank}` : "Saved!";
    renderLeaderboard(data.leaderboard || []);
  } catch {
    btn.disabled = false;
  }
}

async function loadLeaderboard() {
  try {
    const res = await fetch(`/api/quiz/${code}/attempt`);
    const data = await res.json();
    renderLeaderboard(data.leaderboard || []);
  } catch {
    /* ignore */
  }
}

function renderLeaderboard(rows) {
  const el = document.getElementById("lb");
  if (!el) return;
  if (!rows.length) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<h3>Leaderboard</h3>${rows
    .map(
      (r, i) => `
    <div class="lb-row">
      <span class="lb-rank">${i + 1}</span>
      <span class="lb-name">${escapeHtml(r.playerName)}</span>
      <span class="lb-score">${r.score}</span>
    </div>`,
    )
    .join("")}`;
}

document.addEventListener("keydown", (e) => {
  if (phase === "intro" && e.key === "Enter") start();
  else if (phase === "playing" && questions[index]) {
    const n = Number(e.key);
    if (n >= 1 && n <= questions[index].options.length) {
      const opt = questions[index].options[n - 1];
      if (!eliminated.includes(opt.id)) submitAnswer(opt.id);
    }
  } else if (phase === "reveal" && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    next();
  }
});

loadQuiz();
