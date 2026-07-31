const TEXT_EXTENSIONS = [
  ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".log", ".rtf",
  ".html", ".htm", ".xml", ".yml", ".yaml", ".srt", ".tex",
];

export const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, ".pdf", ".docx"];

function stripMarkup(value: string) {
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

function stripMarkdown(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\*\*|__|\*|_/g, "");
}

export async function extractText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buffer = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await pdfExtract(pdf, { mergePages: true });
    return Array.isArray(text) ? text.join("\n\n") : text;
  }

  if (
    name.endsWith(".docx") ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    const mammoth = (await import("mammoth")).default;
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  const raw = buffer.toString("utf8");
  if (name.endsWith(".html") || name.endsWith(".htm") || name.endsWith(".xml")) {
    return stripMarkup(raw);
  }
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return stripMarkdown(raw);
  }
  if (name.endsWith(".json")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const collected: string[] = [];
      const walk = (node: unknown) => {
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

export function isSupported(fileName: string) {
  const lower = fileName.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
