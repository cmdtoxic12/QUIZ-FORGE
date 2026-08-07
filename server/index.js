const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const { extractText, validateUpload } = require("./lib/extract");
const { sampleAcrossDocument } = require("./lib/text");
const { config, validateConfig } = require("./lib/config");
const { cleanTextInput, safeFilename, requestId, apiError } = require("./lib/security");
const { validateCredentials, hashPassword, verifyPassword, issueToken, optionalAuth } = require("./lib/auth");
const { generateQuiz } = require("./lib/quiz-service");
const jsonStore = require("./store");

validateConfig();
const store = config.storeDriver === "postgres" ? require("./postgres-store").createPostgresStore(config.databaseUrl) : jsonStore;
const app = express();
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_CHARS = 140000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = (length = 7) => Array.from({ length }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join("");
const maybeAwait = (value) => Promise.resolve(value);

app.disable("x-powered-by");
app.use(requestId);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-origin" } }));
app.use(cors({ origin(origin, callback) { if (!origin || !config.corsOrigins.length || config.corsOrigins.includes(origin)) return callback(null, true); return callback(apiError(403, "Origin is not allowed.")); }, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization"] }));
app.use(express.json({ limit: "2mb" }));
app.use(optionalAuth);
app.use("/api", rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "..", "public"), { maxAge: config.isProduction ? "1h" : 0 }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 5 }, fileFilter(_req, file, cb) { cb(null, Boolean(path.extname(file.originalname))); } });

app.get("/api/health", (_req, res) => res.json({ ok: true, engine: config.quizEngine, storage: config.storeDriver, requestId: res.locals.requestId }));
app.get("/api/quizzes", async (_req, res, next) => { try { res.json({ quizzes: await maybeAwait(store.listQuizzes(40)) }); } catch (err) { next(err); } });

app.post("/api/auth/register", rateLimit({ windowMs: 60 * 60 * 1000, limit: 10 }), async (req, res, next) => {
  try { const credentials = validateCredentials(req.body || {}); if (await maybeAwait(store.findUserByEmail(credentials.email))) throw apiError(409, "An account already exists for that email."); const user = await maybeAwait(store.createUser({ email: credentials.email, passwordHash: await hashPassword(credentials.password) })); res.status(201).json({ user, token: issueToken(user) }); } catch (err) { next(err); }
});
app.post("/api/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), async (req, res, next) => {
  try { const credentials = validateCredentials(req.body || {}); const user = await maybeAwait(store.findUserByEmail(credentials.email)); if (!user || !(await verifyPassword(credentials.password, user.passwordHash))) throw apiError(401, "Invalid email or password."); res.json({ user: { id: user.id, email: user.email, createdAt: user.createdAt }, token: issueToken(user) }); } catch (err) { next(err); }
});

app.post("/api/quiz/generate", rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), upload.array("files", 5), async (req, res, next) => {
  try {
    const files = req.files || []; const pasted = cleanTextInput(req.body.text); const count = Math.min(Math.max(Number(req.body.count) || 10, 5), 20); const difficulty = ["easy", "medium", "hard", "mixed"].includes(req.body.difficulty) ? req.body.difficulty : "mixed";
    if (!files.length && !pasted) throw apiError(400, "Upload at least one document or paste some text.");
    const chunks = []; const sourceNames = [];
    for (const file of files) { const uploadError = validateUpload(file); if (uploadError) throw apiError(400, `${safeFilename(file.originalname)}: ${uploadError}`); const text = await extractText(file.buffer, file.originalname); if (text.trim().length > 40) { chunks.push(text); sourceNames.push(safeFilename(file.originalname)); } }
    if (pasted) { chunks.push(pasted); sourceNames.push("pasted notes"); }
    const merged = chunks.join("\n\n"); if (merged.trim().length < 200) throw apiError(422, "We couldn't read enough text. For images or scanned PDFs, enable OCR or upload a text-based document.");
    const sourceText = sampleAcrossDocument(merged, MAX_SOURCE_CHARS); const generated = await generateQuiz(sourceText, { count, difficulty, sourceName: sourceNames[0] || "your notes" }, config);
    let code; do { code = makeCode(7); } while (await maybeAwait(store.getQuiz(code)));
    await maybeAwait(store.saveQuiz({ code, title: generated.title, subtitle: generated.subtitle, sourceNames, engine: generated.engine, difficulty, questionCount: generated.questions.length, wordCount: generated.wordCount, keywords: generated.keywords, questions: generated.questions, sourceText, rootCode: code, version: 1, ownerId: req.user?.sub || null }));
    res.status(201).json({ code, title: generated.title, questionCount: generated.questions.length, engine: generated.engine });
  } catch (err) { next(err); }
});
app.get("/api/quiz/:code", async (req, res, next) => { try { const quiz = await maybeAwait(store.getQuiz(req.params.code.toUpperCase())); if (!quiz) throw apiError(404, "Quiz not found."); await maybeAwait(store.incrementPlays(quiz.code)); res.json({ code: quiz.code, title: quiz.title, subtitle: quiz.subtitle, engine: quiz.engine, difficulty: quiz.difficulty, keywords: quiz.keywords || [], sourceNames: quiz.sourceNames || [], wordCount: quiz.wordCount || 0, questions: quiz.questions }); } catch (err) { next(err); } });
app.post("/api/quiz/:code/regenerate", rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), async (req, res, next) => { try { const prior = await maybeAwait(store.getQuiz(req.params.code.toUpperCase())); if (!prior) throw apiError(404, "Quiz not found."); if (!prior.sourceText) throw apiError(422, "This older quiz has no saved source snapshot. Upload the document again to create a regeneratable version."); let code; do { code = makeCode(7); } while (await maybeAwait(store.getQuiz(code))); const generated = await generateQuiz(prior.sourceText, { count: prior.questionCount || 10, difficulty: prior.difficulty || "mixed", sourceName: prior.sourceNames?.[0] || "your notes", variationSeed: code }, config); const version = (prior.version || 1) + 1; await maybeAwait(store.saveQuiz({ code, title: generated.title, subtitle: generated.subtitle, sourceNames: prior.sourceNames || [], engine: generated.engine, difficulty: prior.difficulty || "mixed", questionCount: generated.questions.length, wordCount: generated.wordCount, keywords: generated.keywords, questions: generated.questions, sourceText: prior.sourceText, rootCode: prior.rootCode || prior.code, parentCode: prior.code, version, ownerId: prior.ownerId || req.user?.sub || null })); res.status(201).json({ code, version, parentCode: prior.code }); } catch (err) { next(err); } });
app.get("/api/quiz/:code/attempt", async (req, res, next) => { try { const code = req.params.code.toUpperCase(); if (!(await maybeAwait(store.getQuiz(code)))) throw apiError(404, "Quiz not found."); res.json({ leaderboard: await maybeAwait(store.getLeaderboard(code)) }); } catch (err) { next(err); } });
app.post("/api/quiz/:code/attempt", async (req, res, next) => { try { const code = req.params.code.toUpperCase(); if (!(await maybeAwait(store.getQuiz(code)))) throw apiError(404, "Quiz not found."); const body = req.body || {}; const attempt = { playerName: cleanTextInput(body.playerName, 50) || "Anonymous", score: Math.max(0, Number(body.score) || 0), correct: Math.max(0, Number(body.correct) || 0), total: Math.max(0, Number(body.total) || 0), maxStreak: Math.max(0, Number(body.maxStreak) || 0), durationMs: Math.max(0, Number(body.durationMs) || 0) }; res.json(await maybeAwait(store.addAttempt(code, attempt))); } catch (err) { next(err); } });
app.get("/play/:code", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "play.html")));
app.get("/library", (_req, res) => res.sendFile(path.join(__dirname, "..", "public", "library.html")));
app.use((err, req, res, _next) => { if (err instanceof multer.MulterError) err = apiError(400, err.code === "LIMIT_FILE_SIZE" ? "A file exceeds the 12 MB limit." : "Invalid upload."); const status = err.status || 500; if (status >= 500) console.error({ requestId: res.locals.requestId, error: err.message, stack: err.stack }); res.status(status).json({ error: status >= 500 ? "Something went wrong while processing your request." : err.message, code: err.code || "INTERNAL_ERROR", requestId: res.locals.requestId }); });
if (require.main === module) app.listen(config.port, () => console.log(`QuizForge running at http://localhost:${config.port}`));
module.exports = app;
