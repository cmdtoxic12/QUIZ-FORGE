const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
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
const MAX_TOTAL_UPLOAD_BYTES = 24 * 1024 * 1024;
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
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'sha256-Fu42Isz6usX9624LvhAsDckpJXCxPq368rZrfwQ7YAs='",
          "'sha256-Nl3vJensQZTo0+BKhE8gk8qemtMp+FZW1/tsBiElnjg='",
          "'sha256-xeFzLyvTRy/Wg/oeWT81ZFvdkli9KhcpcJ5KLepjeOQ='",
        ],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null,
      },
    },
    crossOriginResourcePolicy: { policy: "same-origin" },
  }),
);
app.use(
  (req, _res, next) => {
    const origin = req.get("origin");
    if (!origin || config.corsOrigins.includes(origin)) return next();
    if (config.corsOrigins.length) return next(apiError(403, "Origin is not allowed."));
    try {
      const parsed = new URL(origin);
      const forwardedProto = String(req.headers["x-forwarded-proto"] || req.protocol)
        .split(",")[0]
        .trim();
      if (parsed.host === req.get("host") && parsed.protocol === `${forwardedProto}:`)
        return next();
    } catch {}
    return next(apiError(403, "Origin is not allowed."));
  },
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Admin-Token"],
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
const boundedMemoryStorage = {
  _handleFile(req, file, callback) {
    const chunks = [];
    let fileSize = 0;
    req.uploadBytes = req.uploadBytes || 0;
    file.stream.on("data", (chunk) => {
      fileSize += chunk.length;
      req.uploadBytes += chunk.length;
      if (req.uploadBytes > MAX_TOTAL_UPLOAD_BYTES) {
        file.stream.destroy(apiError(413, "Combined upload size exceeds the 24 MB limit."));
        return;
      }
      chunks.push(chunk);
    });
    file.stream.once("error", callback);
    file.stream.once("end", () =>
      callback(null, { buffer: Buffer.concat(chunks), size: fileSize }),
    );
  },
  _removeFile(_req, file, callback) {
    delete file.buffer;
    callback(null);
  },
};
const upload = multer({
  storage: boundedMemoryStorage,
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

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
const attemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

app.post("/api/auth/register", registrationLimiter, async (req, res, next) => {
  try {
    const credentials = validateCredentials(req.body || {});
    if (await maybeAwait(store.findUserByEmail(credentials.email))) {
      throw apiError(409, "An account already exists for that email.");
    }
    const user = await maybeAwait(
      store.createUser({
        email: credentials.email,
        passwordHash: await hashPassword(credentials.password),
      }),
    );
    res.status(201).json({
      user: { id: user.id, email: user.email },
      token: issueToken(user),
    });
  } catch (err) {
    next(err);
  }
});

app.post("/api/auth/login", loginLimiter, async (req, res, next) => {
  try {
    const credentials = validateCredentials(req.body || {});
    const user = await maybeAwait(store.findUserByEmail(credentials.email));
    if (
      !user ||
      !(await verifyPassword(credentials.password, user.passwordHash))
    ) {
      throw apiError(401, "Invalid email or password.");
    }
    res.json({
      user: { id: user.id, email: user.email },
      token: issueToken(user),
    });
  } catch (err) {
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
      wordCount: quiz.wordCount || 0,
      questions: (quiz.questions || []).map(({ evidenceQuote, sourceId, ...question }) => question),
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
app.post("/api/quiz/:code/attempt", attemptLimiter, async (req, res, next) => {
  try {
    const code = req.params.code.toUpperCase();
    const quiz = await maybeAwait(store.getQuiz(code));
    if (!quiz) throw apiError(404, "Quiz not found.");
    const body = req.body || {};
    const questionCount = quiz.questions?.length || Number(quiz.questionCount) || 0;
    const isNonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
    if (
      !isNonNegativeInteger(body.score) ||
      !isNonNegativeInteger(body.correct) ||
      !isNonNegativeInteger(body.total) ||
      !isNonNegativeInteger(body.maxStreak) ||
      !isNonNegativeInteger(body.durationMs) ||
      body.total !== questionCount ||
      body.correct > body.total ||
      body.maxStreak > body.correct ||
      body.durationMs > 24 * 60 * 60 * 1000
    ) {
      throw apiError(400, "Score details are outside the allowed range.", "INVALID_ATTEMPT");
    }
    const maxScore = (quiz.questions || []).reduce(
      (total, question) => total + (Number(question.points) || 0) + 150,
      0,
    );
    if (body.score > maxScore)
      throw apiError(400, "Score exceeds the maximum possible for this quiz.", "INVALID_ATTEMPT");
    const attempt = {
      playerName: cleanTextInput(body.playerName, 50).replace(/[\r\n\t]+/g, " ") || "Anonymous",
      score: body.score,
      correct: body.correct,
      total: body.total,
      maxStreak: body.maxStreak,
      durationMs: body.durationMs,
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

const adminPassword = config.adminPassword;

// ----- Visitor ID helper -----
function getVisitorId(req) {
  const cookieId = req.headers.cookie
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith("qf_vid="))
    ?.split("=")[1];

  if (cookieId && cookieId.length > 8) return cookieId;

  return crypto.randomUUID();
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
        `qf_vid=${visitorId}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${config.isProduction ? "; Secure" : ""}`,
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
  const token = req.headers["x-admin-token"];
  if (!adminPassword || !token) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const claims = jwt.verify(token, config.jwtSecret, {
      issuer: "quizforge-admin",
      audience: "quizforge-admin",
    });
    if (claims.scope !== "admin") throw new Error("Invalid scope");
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ----- Admin Login -----
const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
app.post("/api/admin/login", adminLoginLimiter, (req, res) => {
  const { password } = req.body || {};
  const submitted = Buffer.from(typeof password === "string" ? password : "");
  const expected = Buffer.from(adminPassword);
  const matches = expected.length > 0 && submitted.length === expected.length && crypto.timingSafeEqual(submitted, expected);
  if (!matches) {
    return res.status(401).json({ error: "Wrong password" });
  }
  const token = jwt.sign(
    { scope: "admin" },
    config.jwtSecret,
    { expiresIn: "15m", issuer: "quizforge-admin", audience: "quizforge-admin" },
  );
  res.json({ token, expiresIn: 900 });
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
        .slice(0, 10)
        .map((q) => ({
          code: q.code,
          title: q.title,
          plays: q.plays || 0,
          questionCount: q.questionCount,
          difficulty: q.difficulty,
        })),
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
