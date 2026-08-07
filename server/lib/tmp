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

function validateGroundedQuestions(questions, sources) {
  const sourceMap = new Map(
    sources.map((source) => [source.id, normalizeForMatch(source.content)]),
  );

  return questions.map((question, index) => {
    const source = sourceMap.get(question.sourceId);
    const evidence = normalizeForMatch(question.evidenceQuote);

    if (!source || evidence.length < 20 || !source.includes(evidence)) {
      throw new Error(
        `Question ${index + 1} is not grounded in an exact source excerpt.`,
      );
    }

    const output = normalizeQuestion(question, index);

    const correctOption = output.options.find(
      (option) => option.id === output.correctOptionId,
    );

    const correctAnswer = normalizeForMatch(correctOption?.text);

    if (!correctAnswer || !evidence.includes(correctAnswer)) {
      throw new Error(
        `Question ${index + 1} answer is not supported by its evidence.`,
      );
    }

    return {
      ...output,
      sourceId: question.sourceId,
      evidenceQuote: question.evidenceQuote,
    };
  });
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
      "evidenceQuote": "exact quote from source"
    }
  ]
}

Mandatory rules:

1. Use exactly four options per question.
2. Use only IDs o0, o1, o2, and o3.
3. The evidenceQuote must be an exact contiguous quote from the selected source.
4. evidenceQuote must be between 20 and 500 characters.
5. The correct option text must appear word-for-word inside evidenceQuote.
6. Never paraphrase the correct answer.
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

Previous generation failed source validation. This is retry ${attempt} of ${MAX_GENERATION_ATTEMPTS}. Be strict: copy the correct answer text exactly from evidenceQuote.`
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
    `The AI could not create fully source-supported questions after ${MAX_GENERATION_ATTEMPTS} attempts. Try generating fewer questions or use clearer source material. Last validation issue: ${lastValidationError?.message || "unknown error"}`,
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
