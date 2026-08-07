/**
 * Simple JSON-file store for quizzes + attempts (no Postgres needed).
 */
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const QUIZZES_FILE = path.join(DATA_DIR, "quizzes.json");
const ATTEMPTS_FILE = path.join(DATA_DIR, "attempts.json");
const USERS_FILE = path.join(DATA_DIR, "users.json");

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUIZZES_FILE)) fs.writeFileSync(QUIZZES_FILE, "{}");
  if (!fs.existsSync(ATTEMPTS_FILE)) fs.writeFileSync(ATTEMPTS_FILE, "{}");
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");
}

function readJson(file) {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, data) {
  ensure();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function saveQuiz(quiz) {
  const all = readJson(QUIZZES_FILE);
  all[quiz.code] = { ...quiz, createdAt: Date.now(), plays: 0 };
  writeJson(QUIZZES_FILE, all);
  return all[quiz.code];
}

function getQuiz(code) {
  const all = readJson(QUIZZES_FILE);
  return all[code] || null;
}

function listQuizzes(limit = 50) {
  const all = readJson(QUIZZES_FILE);
  return Object.values(all)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, limit)
    .map((q) => ({
      code: q.code,
      title: q.title,
      subtitle: q.subtitle,
      difficulty: q.difficulty,
      questionCount: q.questionCount,
      plays: q.plays || 0,
      engine: q.engine,
      keywords: q.keywords || [],
      createdAt: q.createdAt,
    }));
}

function incrementPlays(code) {
  const all = readJson(QUIZZES_FILE);
  if (all[code]) {
    all[code].plays = (all[code].plays || 0) + 1;
    writeJson(QUIZZES_FILE, all);
  }
}

function addAttempt(code, attempt) {
  const all = readJson(ATTEMPTS_FILE);
  if (!all[code]) all[code] = [];
  const entry = {
    id: all[code].length + 1,
    playerName: attempt.playerName || "Anonymous",
    score: attempt.score || 0,
    correct: attempt.correct || 0,
    total: attempt.total || 0,
    maxStreak: attempt.maxStreak || 0,
    durationMs: attempt.durationMs || 0,
    at: Date.now(),
  };
  all[code].push(entry);
  all[code].sort((a, b) => b.score - a.score || a.durationMs - b.durationMs);
  writeJson(ATTEMPTS_FILE, all);
  const rank = all[code].findIndex((a) => a.id === entry.id) + 1;
  return { leaderboard: all[code].slice(0, 20), rank };
}

function getLeaderboard(code) {
  const all = readJson(ATTEMPTS_FILE);
  return (all[code] || []).slice(0, 20);
}

function findUserByEmail(email) {
  const users = readJson(USERS_FILE);
  return Object.values(users).find((user) => user.email === email) || null;
}

function createUser({ email, passwordHash }) {
  const users = readJson(USERS_FILE);
  if (findUserByEmail(email)) throw new Error("An account already exists for that email.");
  const user = { id: `usr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, email, passwordHash, createdAt: Date.now() };
  users[user.id] = user;
  writeJson(USERS_FILE, users);
  return { id: user.id, email: user.email, createdAt: user.createdAt };
}

module.exports = {
  saveQuiz,
  getQuiz,
  listQuizzes,
  incrementPlays,
  addAttempt,
  getLeaderboard,
  findUserByEmail,
  createUser,
};
