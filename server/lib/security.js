const crypto = require("crypto");
function cleanTextInput(value, maxLength = 250000) { return typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, maxLength) : ""; }
function safeFilename(value) { return String(value || "upload").replace(/[\\/\0]/g, "_").replace(/[^\w. -]/g, "_").slice(0, 160); }
function requestId(_req, res, next) { res.locals.requestId = crypto.randomUUID(); res.setHeader("X-Request-Id", res.locals.requestId); next(); }
function apiError(status, message, code = "REQUEST_ERROR") { const error = new Error(message); error.status = status; error.code = code; return error; }
module.exports = { cleanTextInput, safeFilename, requestId, apiError };
