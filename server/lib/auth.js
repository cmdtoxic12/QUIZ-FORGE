const bcrypt = require("bcryptjs"); const jwt = require("jsonwebtoken");
const { config } = require("./config"); const { apiError } = require("./security");
function validateCredentials({ email, password }) { const normalizedEmail = String(email || "").trim().toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) throw apiError(400, "Enter a valid email address."); if (typeof password !== "string" || password.length < 10) throw apiError(400, "Password must be at least 10 characters."); return { email: normalizedEmail, password }; }
async function hashPassword(password) { return bcrypt.hash(password, 12); }
async function verifyPassword(password, hash) { return bcrypt.compare(password, hash); }
function issueToken(user) { return jwt.sign({ sub: user.id, email: user.email }, config.jwtSecret, { expiresIn: "7d", issuer: "quizforge" }); }
function optionalAuth(req, _res, next) { const token = req.headers.authorization?.replace(/^Bearer\s+/i, ""); if (!token) return next(); try { req.user = jwt.verify(token, config.jwtSecret, { issuer: "quizforge" }); } catch {} next(); }
function requireAuth(req, _res, next) { return req.user ? next() : next(apiError(401, "Sign in to use this feature.", "UNAUTHORIZED")); }
module.exports = { validateCredentials, hashPassword, verifyPassword, issueToken, optionalAuth, requireAuth };
