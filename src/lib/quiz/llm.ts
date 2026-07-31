import type { QuizQuestion } from "@/db/schema";
import { sampleAcrossDocument, truncate } from "./text";

type RawQuestion = {
  type?: string;
  prompt?: string;
  question?: string;
  options?: unknown;
  answers?: unknown;
  correctIndex?: number;
  correct_index?: number;
  answer?: string;
  explanation?: string;
  hint?: string;
  difficulty?: string;
  topic?: string;
};

export type LlmQuizResult = {
  engine: string;
  title: string;
  subtitle: string;
  questions: QuizQuestion[];
  keywords: string[];
};

const DIFFICULTY_META: Record<
  QuizQuestion["difficulty"],
  { points: number; seconds: number }
> = {
  easy: { points: 100, seconds: 20 },
  medium: { points: 150, seconds: 25 },
  hard: { points: 200, seconds: 30 },
};

function buildAnalysisPrompt(text: string) {
  return `You are a careful study assistant. Read the SOURCE MATERIAL and produce a structured understanding of it.

Extract:
- A short title and one-line summary
- 4–10 distinct topics/sections that appear in the material (cover early, middle, and late content)
- For each topic: 2–5 key facts that a quiz could test (concrete: names, definitions, numbers, cause/effect, processes)
- Important terms/definitions
- Notable figures, dates, or statistics

Rules:
- Use ONLY information present in the source. Do not invent.
- Spread topics across the whole document, not just the opening.
- Prefer precise, testable facts over vague summaries.

Reply with ONLY minified JSON:
{"title":string,"summary":string,"topics":[{"name":string,"facts":string[]}],"definitions":[{"term":string,"meaning":string}],"figures":string[],"keywords":string[]}

SOURCE MATERIAL:
"""
${text}
"""`;
}

function buildQuizFromAnalysisPrompt(
  analysisJson: string,
  textSample: string,
  count: number,
  difficulty: string,
) {
  return `You are a playful quiz master. You already analysed the document. Use the ANALYSIS and the SOURCE SAMPLE to write ${count} quiz questions.

ANALYSIS (authoritative outline of what the document contains):
${analysisJson}

Rules:
- Every question must be answerable from the ANALYSIS or SOURCE SAMPLE. Never invent facts.
- Spread questions across DIFFERENT topics from the analysis (do not cluster on one chapter).
- Mix types: "multiple-choice", "true-false", "fill-blank", "which-true".
- Non true/false: exactly 4 options. true/false: exactly ["True","False"].
- Distractors must be plausible (related wrong terms/figures from the same domain).
- Prompts under 220 characters. "explanation" should cite the supporting fact. "hint" must not give away the answer.
- difficulty is "easy" | "medium" | "hard". Target overall: ${difficulty}.
- correctIndex is 0-based index into options.

Reply with ONLY minified JSON:
{"title":string,"subtitle":string,"keywords":string[],"questions":[{"type":string,"prompt":string,"options":string[],"correctIndex":number,"explanation":string,"hint":string,"difficulty":string,"topic":string}]}

SOURCE SAMPLE (for wording and extra detail):
"""
${textSample}
"""`;
}

function buildPrompt(text: string, count: number, difficulty: string) {
  // Single-shot fallback if analysis fails
  return `You are a playful quiz master. Read the SOURCE MATERIAL and write ${count} quiz questions that can be answered *only* from it.

Rules:
- Mix question types: "multiple-choice", "true-false", "fill-blank", "which-true".
- Every non true/false question needs exactly 4 options; true/false needs exactly ["True","False"].
- Distractors must be plausible and drawn from the same domain as the source.
- Keep prompts under 220 characters and make them fun but precise.
- "explanation" must quote or paraphrase the supporting line from the source.
- "hint" is a short nudge that does not give away the answer.
- difficulty is one of "easy" | "medium" | "hard". Target overall difficulty: ${difficulty}.
- Cover DIFFERENT parts of the source (early, middle, and late sections). Do not cluster all questions on the opening topic.
- Prefer concrete facts, names, numbers, definitions, and cause/effect over vague claims.
- Never invent facts that are not supported by the source.

Reply with ONLY minified JSON of shape:
{"title":string,"subtitle":string,"keywords":string[],"questions":[{"type":string,"prompt":string,"options":string[],"correctIndex":number,"explanation":string,"hint":string,"difficulty":string,"topic":string}]}

SOURCE MATERIAL:
"""
${text}
"""`;
}

async function callOpenAi(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You output strict JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-latest",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
  const data = (await res.json()) as { content?: Array<{ text?: string }> };
  return data.content?.map((part) => part.text ?? "").join("") ?? "";
}

async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const model = process.env.GEMINI_MODEL ?? "gemini-3.5-flash";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.7,
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    ""
  );
}

export function detectProvider() {
  if (process.env.OPENAI_API_KEY) return "openai" as const;
  if (process.env.ANTHROPIC_API_KEY) return "anthropic" as const;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
    return "gemini" as const;
  return null;
}

function parseJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start)
      return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Model returned invalid JSON");
  }
}

function normalise(raw: unknown, fallbackTitle: string): LlmQuizResult | null {
  if (!raw || typeof raw !== "object") return null;
  const payload = raw as {
    title?: string;
    subtitle?: string;
    keywords?: unknown;
    questions?: unknown;
  };
  const rawQuestions = Array.isArray(payload.questions)
    ? (payload.questions as RawQuestion[])
    : [];

  const questions: QuizQuestion[] = [];
  rawQuestions.forEach((item, index) => {
    const prompt = (item.prompt ?? item.question ?? "").toString().trim();
    const optionSource = Array.isArray(item.options)
      ? item.options
      : Array.isArray(item.answers)
        ? item.answers
        : [];
    const options = optionSource
      .map((option) => (typeof option === "string" ? option.trim() : ""))
      .filter(Boolean);
    if (!prompt || options.length < 2) return;

    let correctIndex = item.correctIndex ?? item.correct_index;
    if (typeof correctIndex !== "number" && typeof item.answer === "string") {
      correctIndex = options.findIndex(
        (option) => option.toLowerCase() === item.answer!.toLowerCase().trim(),
      );
    }
    if (
      typeof correctIndex !== "number" ||
      correctIndex < 0 ||
      correctIndex >= options.length
    ) {
      return;
    }

    const type = (
      ["multiple-choice", "true-false", "fill-blank", "which-true"] as const
    ).includes(item.type as QuizQuestion["type"])
      ? (item.type as QuizQuestion["type"])
      : options.length === 2
        ? "true-false"
        : "multiple-choice";

    const difficulty = (["easy", "medium", "hard"] as const).includes(
      item.difficulty as QuizQuestion["difficulty"],
    )
      ? (item.difficulty as QuizQuestion["difficulty"])
      : "medium";

    const meta = DIFFICULTY_META[difficulty];
    questions.push({
      id: `q${index + 1}`,
      type,
      prompt: truncate(prompt, 300),
      options: options.map((text, i) => ({ id: `o${i}`, text })),
      correctOptionId: `o${correctIndex}`,
      explanation: (item.explanation ?? "").toString().slice(0, 400),
      hint: (item.hint ?? "Think back to the source material.")
        .toString()
        .slice(0, 200),
      difficulty,
      points: meta.points,
      seconds: meta.seconds,
      topic: (item.topic ?? "General").toString().slice(0, 60),
    });
  });

  if (questions.length < 3) return null;

  return {
    engine: "llm",
    title: (payload.title ?? fallbackTitle).toString().slice(0, 120),
    subtitle: (payload.subtitle ?? "").toString().slice(0, 200),
    keywords: Array.isArray(payload.keywords)
      ? (payload.keywords as unknown[]).map(String).slice(0, 10)
      : [],
    questions,
  };
}

export type DocumentAnalysis = {
  title: string;
  summary: string;
  topics: Array<{ name: string; facts: string[] }>;
  definitions: Array<{ term: string; meaning: string }>;
  figures: string[];
  keywords: string[];
};

function normaliseAnalysis(raw: unknown): DocumentAnalysis | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as {
    title?: string;
    summary?: string;
    topics?: unknown;
    definitions?: unknown;
    figures?: unknown;
    keywords?: unknown;
  };
  const topics: Array<{ name: string; facts: string[] }> = [];
  if (Array.isArray(p.topics)) {
    for (const t of p.topics) {
      if (!t || typeof t !== "object") continue;
      const row = t as { name?: string; facts?: unknown };
      const name = (row.name ?? "").toString().trim();
      if (!name) continue;
      const facts = Array.isArray(row.facts)
        ? row.facts
            .map((f) => String(f).trim())
            .filter(Boolean)
            .slice(0, 8)
        : [];
      topics.push({ name: name.slice(0, 80), facts });
    }
  }
  if (topics.length < 1) return null;

  const definitions: Array<{ term: string; meaning: string }> = [];
  if (Array.isArray(p.definitions)) {
    for (const d of p.definitions) {
      if (!d || typeof d !== "object") continue;
      const row = d as { term?: string; meaning?: string };
      const term = (row.term ?? "").toString().trim();
      const meaning = (row.meaning ?? "").toString().trim();
      if (term && meaning)
        definitions.push({
          term: term.slice(0, 80),
          meaning: meaning.slice(0, 240),
        });
    }
  }

  return {
    title: (p.title ?? "Document Quiz").toString().slice(0, 120),
    summary: (p.summary ?? "").toString().slice(0, 400),
    topics: topics.slice(0, 12),
    definitions: definitions.slice(0, 20),
    figures: Array.isArray(p.figures) ? p.figures.map(String).slice(0, 15) : [],
    keywords: Array.isArray(p.keywords)
      ? p.keywords.map(String).slice(0, 12)
      : [],
  };
}

async function callProvider(
  prompt: string,
  provider: "openai" | "anthropic" | "gemini",
): Promise<string> {
  if (provider === "openai")
    return callOpenAi(prompt, process.env.OPENAI_API_KEY!);
  if (provider === "anthropic")
    return callAnthropic(prompt, process.env.ANTHROPIC_API_KEY!);
  return callGemini(
    prompt,
    (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)!,
  );
}

/** Phase 1: understand the document structure and key facts. */
export async function analyseDocument(
  text: string,
): Promise<DocumentAnalysis | null> {
  const provider = detectProvider();
  if (!provider) return null;
  const sample = sampleAcrossDocument(text, 40_000);
  try {
    const raw = await callProvider(buildAnalysisPrompt(sample), provider);
    if (!raw) return null;
    return normaliseAnalysis(parseJson(raw));
  } catch (error) {
    console.error("Document analysis failed", error);
    return null;
  }
}

export async function generateWithLlm(
  text: string,
  count: number,
  difficulty: string,
  fallbackTitle: string,
): Promise<LlmQuizResult | null> {
  const provider = detectProvider();
  if (!provider) return null;

  const sample = sampleAcrossDocument(text, 36_000);

  try {
    // Phase 1 — understand
    let analysis: DocumentAnalysis | null = null;
    try {
      const analysisRaw = await callProvider(
        buildAnalysisPrompt(sampleAcrossDocument(text, 40_000)),
        provider,
      );
      if (analysisRaw) analysis = normaliseAnalysis(parseJson(analysisRaw));
    } catch (err) {
      console.error("Analysis phase failed, falling back to single-shot", err);
    }

    // Phase 2 — generate from understanding (or single-shot fallback)
    let raw = "";
    if (analysis && analysis.topics.length >= 1) {
      const analysisJson = JSON.stringify(analysis);
      raw = await callProvider(
        buildQuizFromAnalysisPrompt(analysisJson, sample, count, difficulty),
        provider,
      );
    } else {
      raw = await callProvider(
        buildPrompt(sample, count, difficulty),
        provider,
      );
    }

    if (!raw) return null;
    const result = normalise(parseJson(raw), analysis?.title ?? fallbackTitle);
    if (!result) return null;

    if (analysis) {
      if (!result.keywords.length && analysis.keywords.length) {
        result.keywords = analysis.keywords;
      }
      if (!result.subtitle && analysis.summary) {
        result.subtitle = analysis.summary.slice(0, 200);
      }
      result.engine = `llm:${provider}+analyse`;
    } else {
      result.engine = `llm:${provider}`;
    }
    return result;
  } catch (error) {
    console.error("LLM quiz generation failed, using local engine", error);
    return null;
  }
}
