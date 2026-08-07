const test = require("node:test");
const assert = require("node:assert/strict");
const { generateLocalQuiz } = require("../server/lib/local-engine");
const { normalizeQuestion, validateGroundedQuestions } = require("../server/lib/quiz-service");

const source = `Photosynthesis converts light energy into chemical energy stored in glucose. Chlorophyll absorbs blue and red light. The Calvin cycle fixes carbon dioxide into sugar. In 1961, Melvin Calvin received a Nobel Prize in Chemistry. Photosynthesis produces oxygen as a by-product. Rates increase with light intensity until a plateau is reached. Chloroplasts contain the pigment chlorophyll. Carbon dioxide concentration can become a limiting factor.`;

test("local generator returns usable questions with learning support", () => {
  const quiz = generateLocalQuiz(source, { count: 5, difficulty: "mixed", sourceName: "notes" });
  assert.ok(quiz.questions.length >= 1);
  for (const question of quiz.questions) {
    const normalized = normalizeQuestion(question, 0);
    assert.ok(normalized.options.some((option) => option.id === normalized.correctOptionId));
    assert.ok(normalized.explanation.length > 0);
    assert.ok(normalized.hint.length > 0);
  }
});

test("grounding validation rejects an answer absent from source evidence", () => {
  const sources = [{ id: "S1", content: "Chlorophyll absorbs blue and red light in plants." }];
  const question = { prompt: "What does chlorophyll absorb?", options: [{ id: "o0", text: "Blue and red light" }, { id: "o1", text: "Sound" }], correctOptionId: "o0", sourceId: "S1", evidenceQuote: "Chlorophyll absorbs blue and red light in plants." };
  assert.equal(validateGroundedQuestions([question], sources).length, 1);
  question.options[0].text = "Infrared light";
  assert.throws(() => validateGroundedQuestions([question], sources));
});
