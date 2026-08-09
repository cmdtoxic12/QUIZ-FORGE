const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { config } = require("./config");
const { apiError } = require("./security");

function validateCredentials({ email, password }) {
  const normalizedEmail = String(email || "")
    .trim()
    .toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
    throw apiError(400, "Enter a valid email address.");
  }
  if (typeof password !== "string" || password.length < 10) {
    throw apiError(400, "Password must be at least 10 characters.");
  }
  return { email: normalizedEmail, password };
}

async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function issueToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, {
    expiresIn: "7d",
    issuer: "quizforge",
  });
}

function optionalAuth(req, _res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return next();
  try {
    req.user = jwt.verify(token, config.jwtSecret, { issuer: "quizforge" });
  } catch {}
  next();
}

function requireAuth(req, _res, next) {
  return req.user
    ? next()
    : next(apiError(401, "Sign in to use this feature.", "UNAUTHORIZED"));
}

// Verify Google ID token
async function verifyGoogleToken(idToken) {
  const res = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
  );
  if (!res.ok) throw apiError(401, "Invalid Google token.");
  const data = await res.json();

  // Optional: check audience matches your Google Client ID
  if (
    process.env.GOOGLE_CLIENT_ID &&
    data.aud !== process.env.GOOGLE_CLIENT_ID
  ) {
    throw apiError(401, "Google token audience mismatch.");
  }

  if (!data.email || !data.email_verified) {
    throw apiError(401, "Google account email not verified.");
  }

  return {
    email: data.email.toLowerCase(),
    name: data.name || "",
    picture: data.picture || "",
    googleId: data.sub,
  };
}

module.exports = {
  validateCredentials,
  hashPassword,
  verifyPassword,
  issueToken,
  optionalAuth,
  requireAuth,
  verifyGoogleToken,
};
