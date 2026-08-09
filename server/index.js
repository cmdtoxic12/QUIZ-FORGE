const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const { extractText, validateUpload } = require("./lib/extract");
const { sampleAcrossDocument } = require("./lib/text");
const { config, validateConfig } = require("./lib/config");
const {
  cleanTextInput,
  safeFilename,
  requestId,
  apiError,
} = require("./lib/security");
const {
  validateCredentials,
  hashPassword,
  verifyPassword,
  issueToken,
  optionalAuth,
  requireAuth,
  verifyGoogleToken,
} = require("./lib/auth");
const { generateQuiz } = require("./lib/quiz-service");
const jsonStore = require("./store");

validateConfig();
const store =
  config.storeDriver === "postgres"
    ? require("./postgres-store").createPostgresStore(config.databaseUrl)
    : jsonStore;
const app = express();
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_CHARS = 140000;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const makeCode = (length = 7) =>
  Array.from(
    { length },
    () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
  ).join("");
const maybeAwait = (value) => Promise.resolve(value);

app.disable("x-powered-by");
app.use(requestId);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        !config.corsOrigins.length ||
        config.corsOrigins.includes(origin)
      )
        return callback(null, true);
      return callback(apiError(403, "Origin is not allowed."));
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "2mb" }));
app.use(optionalAuth);
app.use(
  "/api",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
  }),
);
app.use(
  express.static(path.join(__dirname, "..", "public"), {
    maxAge: config.isProduction ? "1h" : 0,
  }),
);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 5 },
  fileFilter(_req, file, cb) {
    cb(null, Boolean(path.extname(file.originalname)));
  },
});

app.get("/login", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "login.html"));
});
app.get("/signup", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "signup.html"));
});

app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    engine: config.quizEngine,
    storage: config.storeDriver,
    requestId: res.locals.requestId,
  }),
);
app.get("/api/quizzes", async (_req, res, next) => {
  try {
    res.json({ quizzes: await maybeAwait(store.listQuizzes(40)) });
  } catch (err) {
    next(err);
  }
});

// ===== Auth Routes =====

const { verifyFirebaseToken } = require("./lib/firebase");

app.post("/api/auth/firebase", async (req, res, next) => {
  try {
    const { idToken } = req.body || {};
    if (!idToken) {
      return res.status(400).json({ error: "Missing Firebase ID token" });
    }

    const decoded = await verifyFirebaseToken(idToken);
    const email = (decoded.email || "").toLowerCase();
    const uid = decoded.uid;

    if (!email) {
      return res.status(400).json({ error: "Firebase account has no email" });
    }

    // Find or create user in Postgres
    let user = await maybeAwait(store.findUserByEmail(email));

    if (!user) {
      const randomPass = require("crypto").randomBytes(32).toString("hex");
      user = await maybeAwait(
        store.createUser({
          email,
          passwordHash: await hashPassword(randomPass),
        }),
      );
    }

    // Optional: store firebase uid in memory/response
    res.json({
      user: {
        id: user.id,
        email: user.email,
        firebaseUid: uid,
      },
      token: issueToken(user),
    });
  } catch (err) {
    console.error("Firebase auth error:", err.message);
    next(err);
  }
});

// Current user
app.get("/api/auth/me", optionalAuth, requireAuth, async (req, res) => {
  res.json({
    user: { id: req.user.sub, email: req.user.email },
  });
});

// My Quizzes
app.get(
  "/api/quizzes/mine",
  optionalAuth,
  requireAuth,
  async (req, res, next) => {
    try {
      const all = await maybeAwait(store.listQuizzes(200));
      const mine = all.filter((q) => q.ownerId === req.user.sub);
      res.json({ quizzes: mine });
    } catch (err) {
      next(err);
    }
  },
);

app.post(
  "/api/quiz/generate",
  optionalAuth,
  requireAuth, // ← hard protection
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }),
  upload.array("files", 5),
  async (req, res, next) => {
    try {
      const files = req.files || [];
      const pasted = cleanTextInput(req.body.text);
      const count = Math.min(Math.max(Number(req.body.count) || 10, 5), 20);
      const difficulty = ["easy", "medium", "hard", "mixed"].includes(
        req.body.difficulty,
      )
        ? req.body.difficulty
        : "mixed";
      if (!files.length && !pasted)
        throw apiError(400, "Upload at least one document or paste some text.");
      const chunks = [];
      const sourceNames = [];
      for (const file of files) {
        const uploadError = validateUpload(file);
        if (uploadError)
          throw apiError(
            400,
            `${safeFilename(file.originalname)}: ${uploadError}`,
          );
        const text = await extractText(file.buffer, file.originalname);
        if (text.trim().length > 40) {
          chunks.push(text);
          sourceNames.push(safeFilename(file.originalname));
        }
      }
      if (pasted) {
        chunks.push(pasted);
        sourceNames.push("pasted notes");
      }
      const merged = chunks.join("\n\n");
      if (merged.trim().length < 200)
        throw apiError(
          422,
          "We couldn't read enough text. For images or scanned PDFs, enable OCR or upload a text-based document.",
        );
      const sourceText = sampleAcrossDocument(merged, MAX_SOURCE_CHARS);
      const generated = await generateQuiz(
        sourceText,
        { count, difficulty, sourceName: sourceNames[0] || "your notes" },
        config,
      );
      let code;
      do {
        code = makeCode(7);
      } while (await maybeAwait(store.getQuiz(code)));
      await maybeAwait(
        store.saveQuiz({
          code,
          title: generated.title,
          subtitle: generated.subtitle,
          sourceNames,
          engine: generated.engine,
          difficulty,
          questionCount: generated.questions.length,
          wordCount: generated.wordCount,
          keywords: generated.keywords,
          questions: generated.questions,
          sourceText,
          rootCode: code,
          version: 1,
          ownerId: req.user?.sub || null,
        }),
      );
      res.status(201).json({
        code,
        title: generated.title,
        questionCount: generated.questions.length,
        engine: generated.engine,
      });
    } catch (err) {
      next(err);
    }
  },
);
app.get("/api/quiz/:code", async (req, res, next) => {
  try {
    const quiz = await maybeAwait(store.getQuiz(req.params.code.toUpperCase()));
    if (!quiz) throw apiError(404, "Quiz not found.");
    await maybeAwait(store.incrementPlays(quiz.code));
    res.json({
      code: quiz.code,
      title: quiz.title,
      subtitle: quiz.subtitle,
      engine: quiz.engine,
      difficulty: quiz.difficulty,
      keywords: quiz.keywords || [],
      sourceNames: quiz.sourceNames || [],
      wordCount: quiz.wordCount || 0,
      questions: quiz.questions,
    });
  } catch (err) {
    next(err);
  }
});
app.post(
  "/api/quiz/:code/regenerate",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }),
  async (req, res, next) => {
    try {
      const prior = await maybeAwait(
        store.getQuiz(req.params.code.toUpperCase()),
      );
      if (!prior) throw apiError(404, "Quiz not found.");
      if (!prior.sourceText)
        throw apiError(
          422,
          "This older quiz has no saved source snapshot. Upload the document again to create a regeneratable version.",
        );
      let code;
      do {
        code = makeCode(7);
      } while (await maybeAwait(store.getQuiz(code)));
      const generated = await generateQuiz(
        prior.sourceText,
        {
          count: prior.questionCount || 10,
          difficulty: prior.difficulty || "mixed",
          sourceName: prior.sourceNames?.[0] || "your notes",
          variationSeed: code,
        },
        config,
      );
      const version = (prior.version || 1) + 1;
      await maybeAwait(
        store.saveQuiz({
          code,
          title: generated.title,
          subtitle: generated.subtitle,
          sourceNames: prior.sourceNames || [],
          engine: generated.engine,
          difficulty: prior.difficulty || "mixed",
          questionCount: generated.questions.length,
          wordCount: generated.wordCount,
          keywords: generated.keywords,
          questions: generated.questions,
          sourceText: prior.sourceText,
          rootCode: prior.rootCode || prior.code,
          parentCode: prior.code,
          version,
          ownerId: prior.ownerId || req.user?.sub || null,
        }),
      );
      res.status(201).json({ code, version, parentCode: prior.code });
    } catch (err) {
      next(err);
    }
  },
);
app.get("/api/quiz/:code/attempt", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!(await maybeAwait(store.getQuiz(code))))
      throw apiError(404, "Quiz not found.");
    res.json({ leaderboard: await maybeAwait(store.getLeaderboard(code)) });
  } catch (err) {
    next(err);
  }
});
app.post("/api/quiz/:code/attempt", async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    if (!(await maybeAwait(store.getQuiz(code))))
      throw apiError(404, "Quiz not found.");
    const body = req.body || {};
    const attempt = {
      playerName: cleanTextInput(body.playerName, 50) || "Anonymous",
      score: Math.max(0, Number(body.score) || 0),
      correct: Math.max(0, Number(body.correct) || 0),
      total: Math.max(0, Number(body.total) || 0),
      maxStreak: Math.max(0, Number(body.maxStreak) || 0),
      durationMs: Math.max(0, Number(body.durationMs) || 0),
    };
    res.json(await maybeAwait(store.addAttempt(code, attempt)));
  } catch (err) {
    next(err);
  }
});
app.get("/play/:code", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "public", "play.html")),
);
app.get("/library", (_req, res) =>
  res.sendFile(path.join(__dirname, "..", "public", "library.html")),
);
app.use((err, req, res, _next) => {
  if (err instanceof multer.MulterError)
    err = apiError(
      400,
      err.code === "LIMIT_FILE_SIZE"
        ? "A file exceeds the 12 MB limit."
        : "Invalid upload.",
    );
  const status = err.status || 500;
  if (status >= 500)
    console.error({
      requestId: res.locals.requestId,
      error: err.message,
      stack: err.stack,
    });
  res.status(status).json({
    error:
      status >= 500
        ? "Something went wrong while processing your request."
        : err.message,
    code: err.code || "INTERNAL_ERROR",
    requestId: res.locals.requestId,
  });
});
if (require.main === module)
  app.listen(config.port, () =>
    console.log(`QuizForge running at http://localhost:${config.port}`),
  );
module.exports = app;

// ======================
// ADMIN + VISITOR TRACKING
// ======================

const adminPassword = process.env.ADMIN_PASSWORD || "";
const crypto = require("crypto");

// ----- Visitor ID helper -----
function getVisitorId(req) {
  const cookieId = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("qf_vid="))
    ?.split("=")[1];

  if (cookieId && cookieId.length > 8) return cookieId;

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    "unknown";
  const ua = req.headers["user-agent"] || "";
  return crypto
    .createHash("sha256")
    .update(ip + ua)
    .digest("hex")
    .slice(0, 16);
}

// ----- Track every page view -----
async function trackVisit(req, res, next) {
  if (req.path.startsWith("/api") || req.path.startsWith("/admin")) {
    return next();
  }

  try {
    const visitorId = getVisitorId(req);
    const path = req.path || "/";
    const userAgent = (req.headers["user-agent"] || "").slice(0, 200);

    // Set cookie for 1 year
    if (!req.headers.cookie?.includes("qf_vid=")) {
      res.setHeader(
        "Set-Cookie",
        `qf_vid=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax`,
      );
    }

    if (config.storeDriver === "postgres" && store.pool) {
      await store.pool.query(
        "INSERT INTO visits (visitor_id, path, user_agent) VALUES ($1, $2, $3)",
        [visitorId, path, userAgent],
      );
    } else {
      global.__visits = global.__visits || [];
      global.__visits.push({ visitorId, path, at: Date.now() });
      if (global.__visits.length > 5000) {
        global.__visits = global.__visits.slice(-5000);
      }
    }
  } catch (err) {
    console.error("Visit tracking error:", err.message);
  }

  next();
}

// Place this early (after express.json / cors, before routes)
app.use(trackVisit);

// ----- Admin Auth -----
function requireAdmin(req, res, next) {
  const token = req.headers["x-admin-token"] || req.query.token;
  if (!adminPassword || token !== adminPassword) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ----- Admin Login -----
app.post("/api/admin/login", (req, res) => {
  const { password } = req.body || {};
  if (!adminPassword || password !== adminPassword) {
    return res.status(401).json({ error: "Wrong password" });
  }
  res.json({ token: adminPassword });
});

// ----- Admin Stats -----
app.get("/api/admin/stats", requireAdmin, async (req, res, next) => {
  try {
    const quizzes = (await maybeAwait(store.listQuizzes(500))) || [];
    const totalQuizzes = quizzes.length;
    const totalPlays = quizzes.reduce((sum, q) => sum + (q.plays || 0), 0);

    // Collect all attempts
    let allAttempts = [];
    for (const q of quizzes) {
      try {
        const leaderboard =
          (await maybeAwait(store.getLeaderboard(q.code))) || [];
        leaderboard.forEach((attempt) => {
          allAttempts.push({
            ...attempt,
            quizCode: q.code,
            quizTitle: q.title,
          });
        });
      } catch (_) {}
    }
    allAttempts.sort((a, b) => (b.score || 0) - (a.score || 0));

    // ===== Visitor Stats =====
    let totalVisitors = 0;
    let uniqueVisitors = 0;
    let todayVisitors = 0;
    let todayUnique = 0;
    let last7Days = [];

    // ===== User Stats =====
    let totalUsers = 0;
    let recentUsers = [];

    if (config.storeDriver === "postgres" && store.pool) {
      // Visits
      try {
        const totalRes = await store.pool.query(
          "SELECT COUNT(*)::int AS count FROM visits",
        );
        const uniqueRes = await store.pool.query(
          "SELECT COUNT(DISTINCT visitor_id)::int AS count FROM visits",
        );
        totalVisitors = totalRes.rows[0]?.count || 0;
        uniqueVisitors = uniqueRes.rows[0]?.count || 0;

        const todayRes = await store.pool.query(`
          SELECT 
            COUNT(*)::int AS total,
            COUNT(DISTINCT visitor_id)::int AS unique
          FROM visits
          WHERE created_at >= CURRENT_DATE
        `);
        todayVisitors = todayRes.rows[0]?.total || 0;
        todayUnique = todayRes.rows[0]?.unique || 0;

        const weekRes = await store.pool.query(`
          SELECT 
            DATE(created_at) AS day,
            COUNT(*)::int AS total,
            COUNT(DISTINCT visitor_id)::int AS unique
          FROM visits
          WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY DATE(created_at)
          ORDER BY day ASC
        `);
        last7Days = weekRes.rows.map((r) => ({
          day: r.day,
          total: r.total,
          unique: r.unique,
        }));
      } catch (err) {
        console.error("Visits query failed:", err.message);
      }

      // Users
      try {
        const usersRes = await store.pool.query(
          "SELECT COUNT(*)::int AS count FROM users",
        );
        totalUsers = usersRes.rows[0]?.count || 0;

        const recentUsersRes = await store.pool.query(`
          SELECT id, email, created_at 
          FROM users 
          ORDER BY created_at DESC 
          LIMIT 15
        `);
        recentUsers = recentUsersRes.rows.map((u) => ({
          id: u.id,
          email: u.email,
          createdAt: u.created_at,
        }));
      } catch (err) {
        console.error("Users query failed:", err.message);
      }
    } else {
      // In-memory fallback for visits
      const visits = global.__visits || [];
      const oneDay = 24 * 60 * 60 * 1000;
      const todayStart = new Date().setHours(0, 0, 0, 0);

      totalVisitors = visits.length;
      uniqueVisitors = new Set(visits.map((v) => v.visitorId)).size;

      const todayVisits = visits.filter((v) => v.at >= todayStart);
      todayVisitors = todayVisits.length;
      todayUnique = new Set(todayVisits.map((v) => v.visitorId)).size;

      for (let i = 6; i >= 0; i--) {
        const dayStart = todayStart - i * oneDay;
        const dayEnd = dayStart + oneDay;
        const dayVisits = visits.filter(
          (v) => v.at >= dayStart && v.at < dayEnd,
        );
        last7Days.push({
          day: new Date(dayStart).toISOString().slice(0, 10),
          total: dayVisits.length,
          unique: new Set(dayVisits.map((v) => v.visitorId)).size,
        });
      }
    }

    // ===== Response =====
    res.json({
      overview: {
        totalQuizzes,
        totalPlays,
        totalAttempts: allAttempts.length,
        avgScore: allAttempts.length
          ? Math.round(
              allAttempts.reduce((s, a) => s + (a.score || 0), 0) /
                allAttempts.length,
            )
          : 0,
        totalVisitors,
        uniqueVisitors,
        todayVisitors,
        todayUnique,
        totalUsers,
      },
      last7Days,
      recentUsers,
      quizzes: quizzes.map((q) => ({
        code: q.code,
        title: q.title,
        plays: q.plays || 0,
        questionCount: q.questionCount,
        difficulty: q.difficulty,
        engine: q.engine,
        ownerId: q.ownerId || null,
        createdAt: q.createdAt,
      })),
      topQuizzes: [...quizzes]
        .sort((a, b) => (b.plays || 0) - (a.plays || 0))
        .slice(0, 10),
      topPlayers: allAttempts.slice(0, 15),
      recentAttempts: [...allAttempts]
        .sort((a, b) => (b.at || 0) - (a.at || 0))
        .slice(0, 15),
      engine: config.quizEngine,
      storage: config.storeDriver,
    });
  } catch (err) {
    next(err);
  }
});

// Serve admin page
app.get("/admin", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "admin.html"));
});
