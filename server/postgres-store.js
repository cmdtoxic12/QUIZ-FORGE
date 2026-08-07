/* PostgreSQL adapter. Enable with STORE_DRIVER=postgres after running db/schema.sql. */
const { Pool } = require("pg");
function createPostgresStore(connectionString) {
  const pool = new Pool({ connectionString, ssl: process.env.PGSSLMODE === "disable" ? false : undefined });
  return {
    async saveQuiz(quiz) { const saved = { ...quiz, createdAt: Date.now(), plays: 0 }; await pool.query("INSERT INTO quizzes (code, payload) VALUES ($1, $2::jsonb)", [saved.code, JSON.stringify(saved)]); return saved; },
    async getQuiz(code) { const { rows } = await pool.query("SELECT payload FROM quizzes WHERE code=$1", [code]); return rows[0]?.payload || null; },
    async listQuizzes(limit = 50) { const { rows } = await pool.query("SELECT payload FROM quizzes ORDER BY created_at DESC LIMIT $1", [limit]); return rows.map((r) => r.payload); },
    async incrementPlays(code) { await pool.query("UPDATE quizzes SET payload=jsonb_set(payload, '{plays}', to_jsonb(COALESCE((payload->>'plays')::int,0)+1)), created_at=created_at WHERE code=$1", [code]); },
    async addAttempt(code, attempt) { const { rows } = await pool.query("INSERT INTO attempts (quiz_code, payload) VALUES ($1, $2::jsonb) RETURNING payload", [code, JSON.stringify({ ...attempt, at: Date.now() })]); return { leaderboard: [rows[0].payload], rank: 1 }; },
    async getLeaderboard(code) { const { rows } = await pool.query("SELECT payload FROM attempts WHERE quiz_code=$1 ORDER BY (payload->>'score')::int DESC LIMIT 20", [code]); return rows.map((r) => r.payload); },
    async findUserByEmail(email) { const { rows } = await pool.query("SELECT id, email, password_hash AS \"passwordHash\", created_at AS \"createdAt\" FROM users WHERE email=$1", [email]); return rows[0] || null; },
    async createUser({ email, passwordHash }) { const { rows } = await pool.query("INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id,email,created_at AS \"createdAt\"", [email, passwordHash]); return rows[0]; },
    close() { return pool.end(); },
  };
}
module.exports = { createPostgresStore };
