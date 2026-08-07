const { generateLocalQuiz } = require("./local-engine");

const MAX_GENERATION_ATTEMPTS = 3;

function normalizeForMatch(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}%."'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkSource(text, maxLength = 1800) {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks = [];
  let current = "";

  for (const part of parts) {
    if ((current + part).length > maxLength && current) {
      chunks.push(current.trim());
      current = "";
    }
    current += `${part.trim()} `;
  }

  if (current.trim()) chunks.push(current.trim());

  return chunks
    .slice(0, 70)
    .map((content, index) => ({ id: `S${index + 1}`, content }));
}

function normalizeQuestion(question, index) {
  if (Array.isArray(question.options) && question.correctOptionId) {
    const valid =
      question.prompt &&
      question.options.length >= 2 &&
      question.options.some((option) => option.id === question.correctOptionId);

    if (!valid) {
      throw new Error(`Invalid generated question ${index + 1}.`);
    }

    return {
      ...question,
      id: question.id || `q_${index + 1}`,
      explanation:
        question.explanation || "See the source material for context.",
      hint: question.hint || "Review the relevant section.",
    };
  }

  const answers = [
    ...new Set([question.correct, ...(question.distractors || [])]),
  ]
    .filter(Boolean)
    .slice(0, 4);

  if (!question.prompt || !question.correct || answers.length < 2) {
    throw new Error(`Invalid generated question ${index + 1}.`);
  }

  const correctIndex = answers.indexOf(question.correct);

  return {
    ...question,
    id: question.id || `q_${index + 1}`,
    options: answers.map((text, optionIndex) => ({
      id: `o${optionIndex}`,
      text,
    })),
    correctOptionId: `o${correctIndex}`,
    explanation: question.explanation || "See the source material for context.",
    hint: question.hint || "Review the relevant section.",
  };
}

// ===== Flexible grounding helpers =====
function isAnswerSupported(answer, evidence) {
  const a = normalizeForMatch(answer);
  const e = normalizeForMatch(evidence);

  if (!a || a.length < 2 || !e || e.length < 8) return false;

  // Exact match
  if (e.includes(a)) return true;

  // Remove common stop words
  const clean = (str) =>
    str
      .replace(
        /\b(the|a|an|of|in|on|at|to|for|and|or|is|are|was|were|be|been|being|that|this|with|from|by|as|it|its)\b/g,
        " ",
      )
      .replace(/\s+/g, " ")
      .trim();

  const cleanA = clean(a);
  const cleanE = clean(e);

  if (cleanA.length >= 3 && cleanE.includes(cleanA)) return true;

  // Soft keyword match (50% is enough)
  const words = cleanA.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return true;

  const matched = words.filter((w) => cleanE.includes(w));
  return matched.length / words.length >= 0.5;
}

function validateGroundedQuestions(questions, sources) {
  const sourceMap = new Map(
    sources.map((source) => [source.id, normalizeForMatch(source.content)]),
  );

  const valid = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    try {
      const source = sourceMap.get(q.sourceId);
      const evidenceRaw = q.evidenceQuote || "";
      const evidence = normalizeForMatch(evidenceRaw);

      // Skip questions with almost no evidence
      if (!evidence || evidence.length < 8) continue;

      // Soft check that evidence appears in the source
      const hasOverlap =
        !source ||
        source.includes(evidence) ||
        source.includes(evidence.slice(0, 40)) ||
        source.includes(evidence.slice(-40)) ||
        evidence.split(" ").filter((w) => w.length > 3 && source.includes(w))
          .length >= 2;

      if (!hasOverlap) continue;

      const output = normalizeQuestion(q, i);
      const correct = output.options.find(
        (o) => o.id === output.correctOptionId,
      );

      if (!isAnswerSupported(correct?.text, evidenceRaw)) continue;

      valid.push({
        ...output,
        sourceId: q.sourceId,
        evidenceQuote: q.evidenceQuote,
      });
    } catch {
      // skip problematic question
    }
  }

  // Accept the generation if at least 60% of questions are usable
  if (valid.length < Math.ceil(questions.length * 0.6)) {
    throw new Error(
      `Only ${valid.length} out of ${questions.length} questions passed grounding validation.`,
    );
  }

  return valid;
}

function groundedPrompt(count, difficulty, sources, retryMessage = "") {
  return `
Create exactly ${count} ${difficulty} multiple-choice study questions.

Use ONLY the labelled source material below.

Return valid JSON in this shape:

{
  "title": "string",
  "subtitle": "string",
  "keywords": ["string"],
  "questions": [
    {
      "prompt": "string",
      "options": [
        { "id": "o0", "text": "string" },
        { "id": "o1", "text": "string" },
        { "id": "o2", "text": "string" },
        { "id": "o3", "text": "string" }
      ],
      "correctOptionId": "o0",
      "explanation": "string",
      "hint": "string",
      "topic": "string",
      "difficulty": "easy | medium | hard",
      "type": "multiple-choice",
      "sourceId": "S1",
      "evidenceQuote": "relevant excerpt from source"
    }
  ]
}

Mandatory rules:

1. Use exactly four options per question.
2. Use only IDs o0, o1, o2, and o3.
3. The evidenceQuote should be a relevant excerpt from the selected source (close paraphrase is acceptable).
4. evidenceQuote should be between 15 and 500 characters.
5. The correct option text should be clearly supported by the evidenceQuote (exact match preferred, close paraphrase allowed).
6. Prefer answers that appear in the source, but small rephrasing is fine.
7. Never use knowledge outside the supplied source material.
8. Do not create ambiguous questions.
${retryMessage}

Sources:

${sources.map((source) => `[${source.id}] ${source.content}`).join("\n\n")}
`.trim();
}

async function callGemini(prompt, config) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(config.geminiModel)}:generateContent?key=` +
    encodeURIComponent(config.geminiKey);

  let response;

  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 16000,
        },
      }),
      signal: AbortSignal.timeout(90000),
    });
  } catch (error) {
    const cause = error?.cause?.code;

    const connectionError = new Error(
      cause === "EACCES"
        ? "The server environment blocks outbound HTTPS requests to Gemini."
        : `Could not connect to Gemini: ${cause || error.message}`,
    );

    connectionError.status = 502;
    connectionError.code = "GEMINI_CONNECTION_FAILED";
    throw connectionError;
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const apiError = new Error(
      `Gemini request failed: ${body.error?.message || response.statusText}`,
    );

    apiError.status = response.status === 429 ? 429 : 502;
    apiError.code = "GEMINI_API_FAILED";
    throw apiError;
  }

  const text = body.candidates?.[0]?.content?.parts
    ?.map((part) => part.text || "")
    .join("");

  if (!text) {
    const emptyError = new Error("Gemini returned no quiz content.");
    emptyError.status = 502;
    emptyError.code = "GEMINI_EMPTY_RESPONSE";
    throw emptyError;
  }

  try {
    return JSON.parse(text);
  } catch {
    const jsonError = new Error("Gemini returned invalid quiz JSON.");
    jsonError.status = 502;
    jsonError.code = "GEMINI_INVALID_JSON";
    throw jsonError;
  }
}

async function callOpenAi(prompt, config) {
  const OpenAI = require("openai");

  const client = new OpenAI({
    apiKey: config.openAiKey,
  });

  const result = await client.chat.completions.create({
    model: config.openAiModel,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return valid JSON only." },
      { role: "user", content: prompt },
    ],
  });

  return JSON.parse(result.choices[0].message.content || "{}");
}

async function generateQuiz(text, options, config) {
  if (config.quizEngine === "local") {
    const quiz = generateLocalQuiz(text, options);

    return {
      ...quiz,
      engine: "local-nlp",
      questions: quiz.questions.map(normalizeQuestion),
    };
  }

  const sources = chunkSource(text);
  let lastValidationError = null;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const retryMessage =
      attempt > 1
        ? `

Previous generation had grounding issues. This is retry ${attempt} of ${MAX_GENERATION_ATTEMPTS}. Prefer answers that appear in the source, but do not force exact word-for-word copying.`
        : "";

    const prompt = groundedPrompt(
      options.count,
      options.difficulty,
      sources,
      retryMessage,
    );

    const result =
      config.quizEngine === "gemini"
        ? await callGemini(prompt, config)
        : await callOpenAi(prompt, config);

    try {
      if (
        !Array.isArray(result.questions) ||
        result.questions.length < options.count
      ) {
        throw new Error(
          "The AI response did not contain enough usable questions.",
        );
      }

      const questions = validateGroundedQuestions(
        result.questions.slice(0, options.count),
        sources,
      );

      return {
        title: result.title || "Source-grounded study quiz",
        subtitle:
          result.subtitle || "Every answer is backed by your uploaded material",
        keywords: Array.isArray(result.keywords)
          ? result.keywords.slice(0, 12)
          : [],
        wordCount: text.split(/\s+/).length,
        engine: `${config.quizEngine}:${
          config.quizEngine === "gemini"
            ? config.geminiModel
            : config.openAiModel
        }`,
        questions,
      };
    } catch (error) {
      lastValidationError = error;
    }
  }

  const validationError = new Error(
    `The AI could not create fully source-supported questions after ${MAX_GENERATION_ATTEMPTS} attempts. Try generating fewer questions or use clearer source material. Last validation issue: ${
      lastValidationError?.message || "unknown error"
    }`,
  );

  validationError.status = 422;
  validationError.code = "GROUNDING_VALIDATION_FAILED";
  throw validationError;
}

module.exports = {
  generateQuiz,
  normalizeQuestion,
  chunkSource,
  validateGroundedQuestions,
};
