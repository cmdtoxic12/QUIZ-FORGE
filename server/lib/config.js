require("dotenv").config();
const isProduction = process.env.NODE_ENV === "production";
const config = {
  env: process.env.NODE_ENV || "development", isProduction, port: Number(process.env.PORT || 3000),
  corsOrigins: (process.env.CORS_ORIGIN || "").split(",").map((v) => v.trim()).filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || (isProduction ? "" : "development-only-secret-change-me-123456789"),
  storeDriver: process.env.STORE_DRIVER || "json", databaseUrl: process.env.DATABASE_URL || "",
  quizEngine: process.env.QUIZ_ENGINE || "local", openAiKey: process.env.OPENAI_API_KEY || "", openAiModel: process.env.OPENAI_MODEL || "gpt-4o-mini", geminiKey: process.env.GEMINI_API_KEY || "", geminiModel: process.env.GEMINI_MODEL || "gemini-3.5-flash",
  ocrEnabled: process.env.OCR_ENABLED === "true", ocrCommand: process.env.OCR_COMMAND || "tesseract",
};
function validateConfig() {
  if (config.isProduction && config.jwtSecret.length < 32) throw new Error("JWT_SECRET must be at least 32 characters in production.");
  if (config.storeDriver === "postgres" && !config.databaseUrl) throw new Error("DATABASE_URL is required when STORE_DRIVER=postgres.");
  if (config.quizEngine === "openai" && !config.openAiKey) throw new Error("OPENAI_API_KEY is required when QUIZ_ENGINE=openai.");
  if (config.quizEngine === "gemini" && !config.geminiKey) throw new Error("GEMINI_API_KEY is required when QUIZ_ENGINE=gemini.");
  if (!["local", "openai", "gemini"].includes(config.quizEngine)) throw new Error("QUIZ_ENGINE must be local, openai, or gemini.");
}
module.exports = { config, validateConfig };
