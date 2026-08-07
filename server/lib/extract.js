const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const { execFile } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const crypto = require("crypto");
const { config } = require("./config");

const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".rtf",
  ".html", ".htm", ".xml", ".yml", ".yaml", ".srt", ".tex",
];

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];
const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, ".pdf", ".docx", ...IMAGE_EXTENSIONS];

function hasSignature(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  if (extension === ".pdf") return buffer.subarray(0, 5).toString() === "%PDF-";
  if (extension === ".png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if ([".jpg", ".jpeg"].includes(extension)) return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (extension === ".webp") return buffer.subarray(0, 4).toString() === "RIFF" && buffer.subarray(8, 12).toString() === "WEBP";
  if (extension === ".docx") return buffer.subarray(0, 2).toString() === "PK";
  return true;
}

function extensionOf(fileName) { return path.extname(fileName || "").toLowerCase(); }

async function runOcr(buffer, extension) {
  if (!config.ocrEnabled) throw new Error("Image OCR is not enabled. Set OCR_ENABLED=true and install Tesseract, or use a text-based document.");
  const temp = path.join(os.tmpdir(), `quizforge-${crypto.randomUUID()}${extension}`);
  await fs.writeFile(temp, buffer);
  try {
    return await new Promise((resolve, reject) => execFile(config.ocrCommand, [temp, "stdout", "-l", "eng"], { timeout: 60000, maxBuffer: 3 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout)));
  } finally { await fs.unlink(temp).catch(() => {}); }
}

function stripMarkup(value) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripMarkdown(value) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|\*|_/g, "");
}

async function extractText(buffer, fileName) {
  const name = (fileName || "").toLowerCase();

  if (name.endsWith(".pdf")) {
    const data = await pdfParse(buffer);
    return data.text || "";
  }

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }
  if (IMAGE_EXTENSIONS.some((ext) => name.endsWith(ext))) return runOcr(buffer, extensionOf(name));

  const raw = buffer.toString("utf8");

  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xml")) {
    return stripMarkup(raw);
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return stripMarkdown(raw);
  }
  if (name.endsWith(".json")) {
    try {
      const parsed = JSON.parse(raw);
      const collected = [];
      const walk = (node) => {
        if (typeof node === "string") collected.push(node);
        else if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === "object") Object.values(node).forEach(walk);
      };
      walk(parsed);
      return collected.join("\n");
    } catch {
      return raw;
    }
  }
  return raw;
}

function isSupported(fileName) {
  const lower = (fileName || "").toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function validateUpload(file) {
  const extension = extensionOf(file.originalname);
  if (!ACCEPTED_EXTENSIONS.includes(extension)) return "Unsupported file type.";
  if (!hasSignature(file.buffer, extension)) return "The file contents do not match its extension.";
  return null;
}

module.exports = { extractText, isSupported, validateUpload, ACCEPTED_EXTENSIONS, IMAGE_EXTENSIONS };
