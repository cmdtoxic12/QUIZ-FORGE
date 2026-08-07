/**
 * Local NLP quiz engine — generates definition, cloze, numeric,
 * which-true and true/false questions from plain text.
 */
const {
  cleanText,
  escapeRegExp,
  extractTerms,
  hashString,
  isUsefulSentence,
  mulberry32,
  sentenceCase,
  shuffle,
  similarity,
  splitSentences,
  truncate,
  words,
} = require("./text");

const PRONOUN_START =
  /^(it|its|it's|they|their|them|these|those|this|that|he|she|his|her|there|such|both|each|one|another|other|many|most|some|however|therefore|thus|also|finally|meanwhile|instead)\b/i;

function isStandalone(sentence) {
  return !PRONOUN_START.test(sentence.trim());
}

function sourceKeyOf(sentence) {
  return sentence.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 70);
}

const ANTONYMS = {
  increase: "decrease", increases: "decreases", increased: "decreased",
  decrease: "increase", decreases: "increases", decreased: "increased",
  higher: "lower", lower: "higher", more: "less", less: "more",
  always: "never", never: "always", all: "none", none: "all",
  before: "after", after: "before", positive: "negative", negative: "positive",
  major: "minor", minor: "major", first: "last", last: "first",
  large: "small", small: "large", fast: "slow", slow: "fast",
  above: "below", below: "above", internal: "external", external: "internal",
  required: "optional", optional: "required", public: "private", private: "public",
};

const NEGATIONS = [
  [/\bis not\b/, "is"],
  [/\bare not\b/, "are"],
  [/\bcannot\b/, "can"],
  [/\bis\b/, "is not"],
  [/\bare\b/, "are not"],
  [/\bwas\b/, "was not"],
  [/\bwere\b/, "were not"],
  [/\bcan\b/, "cannot"],
  [/\bmust\b/, "must not"],
];

const NUMBER_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?%?\b|\b\d+(?:\.\d+)?%?\b/g;

function perturbNumber(raw, rand) {
  const suffix = raw.endsWith("%") ? "%" : "";
  const core = raw.replace(/%$/, "").replace(/,/g, "");
  const value = Number(core);
  if (!Number.isFinite(value)) return [];
  const decimals = core.includes(".") ? core.split(".")[1].length : 0;
  const isYear = decimals === 0 && value > 1400 && value < 2200;
  const candidates = new Set();
  const deltas = isYear ? [-11, -6, -3, 2, 5, 9, 14] : [0.5, 0.65, 0.8, 1.25, 1.5, 2, 3];
  for (const delta of shuffle(deltas, rand)) {
    const next = isYear ? value + delta : value * delta;
    if (next <= 0 || !Number.isFinite(next)) continue;
    const rounded = decimals ? next.toFixed(decimals) : Math.round(next).toString();
    if (rounded === core) continue;
    const formatted = raw.includes(",") ? Number(rounded).toLocaleString("en-US") : rounded;
    candidates.add(`${formatted}${suffix}`);
    if (candidates.size >= 5) break;
  }
  return [...candidates];
}

function corruptSentence(sentence, terms, rand) {
  const properTerms = terms.filter((t) => t.proper && t.display.length > 3);
  for (const term of shuffle(properTerms.slice(0, 24), rand)) {
    const re = new RegExp(`\\b${escapeRegExp(term.display)}\\b`);
    if (!re.test(sentence)) continue;
    const pool = properTerms.filter(
      (other) =>
        other.term !== term.term &&
        !other.term.includes(term.term) &&
        !term.term.includes(other.term) &&
        !new RegExp(`\\b${escapeRegExp(other.display)}\\b`, "i").test(sentence) &&
        Math.abs(other.words - term.words) <= 1
    );
    if (pool.length) return sentence.replace(re, shuffle(pool, rand)[0].display);
  }
  const numbers = sentence.match(NUMBER_RE);
  if (numbers?.length) {
    const target = numbers[0];
    const options = perturbNumber(target, rand);
    if (options.length) return sentence.replace(target, options[0]);
  }
  for (const [word, opposite] of Object.entries(ANTONYMS)) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(sentence)) return sentence.replace(re, opposite);
  }
  for (const [re, replacement] of NEGATIONS) {
    if (re.test(sentence)) return sentence.replace(re, replacement);
  }
  return null;
}

function pickDistractors(correct, pool, rand, count = 3) {
  const seen = new Set([correct.toLowerCase().trim()]);
  const targetLength = correct.length;
  const scored = pool
    .filter((option) => {
      const key = option.toLowerCase().trim();
      if (!option.trim() || seen.has(key)) return false;
      if (similarity(option, correct) > 0.72) return false;
      seen.add(key);
      return true;
    })
    .map((option) => ({
      option,
      delta: Math.abs(option.length - targetLength) + rand() * 18,
    }))
    .sort((a, b) => a.delta - b.delta)
    .slice(0, count * 3);
  return shuffle(scored, rand).slice(0, count).map((e) => e.option);
}

const DEFINITION_RE =
  /^(?:The|A|An)?\s*([A-Z][A-Za-z0-9'’-]*(?:[\s-][A-Za-z0-9'’-]+){0,3})\s+(?:is|are|was|were|refers to|means|describes|represents|is defined as|is known as|can be described as)\s+(?:a|an|the)?\s*(.{25,200})$/;

function buildDefinitionCandidates(sentences) {
  const pairs = [];
  for (const sentence of sentences) {
    const match = sentence.match(DEFINITION_RE);
    if (!match) continue;
    const term = match[1].trim();
    const definition = sentenceCase(match[2].replace(/\.$/, ""));
    if (term.split(/\s+/).length > 4 || definition.split(/\s+/).length < 5) continue;
    if (PRONOUN_START.test(term)) continue;
    if (pairs.some((p) => p.term.toLowerCase() === term.toLowerCase())) continue;
    pairs.push({ term, definition: truncate(definition, 150), source: sentence });
  }
  return pairs
    .map((pair, index) => {
      const pool = pairs.filter((p) => p.term !== pair.term).map((p) => p.definition);
      return {
        key: `def:${pair.term.toLowerCase()}`,
        sourceKey: sourceKeyOf(pair.source),
        score: 90 - index + pair.definition.length / 40,
        type: "multiple-choice",
        prompt: `According to the document, what best describes “${pair.term}”?`,
        correct: pair.definition,
        distractors: pool,
        explanation: truncate(pair.source, 260),
        hint: `Look for where the document defines ${pair.term}.`,
        topic: pair.term,
        difficulty: "medium",
      };
    })
    .filter((c) => c.distractors.length >= 2);
}

function buildClozeCandidates(sentences, terms, rand) {
  const candidates = [];
  const used = new Set();
  const topTerms = terms.slice(0, 60);
  for (const term of topTerms) {
    if (candidates.length >= 40) break;
    if (used.has(term.term)) continue;
    const re = new RegExp(`\\b${escapeRegExp(term.display)}\\b`, "i");
    const sentence = sentences.find((s) => {
      if (!re.test(s)) return false;
      const w = words(s);
      if (w.length < 10) return false;
      const occurrences = s.match(new RegExp(`\\b${escapeRegExp(term.display)}\\b`, "gi"))?.length ?? 0;
      return occurrences === 1 && !s.toLowerCase().startsWith(term.term.toLowerCase());
    });
    if (!sentence) continue;
    used.add(term.term);
    const blanked = sentence.replace(re, "＿＿＿＿＿");
    const pool = topTerms
      .filter(
        (other) =>
          other.term !== term.term &&
          other.proper === term.proper &&
          Math.abs(other.words - term.words) <= 1 &&
          !new RegExp(`\\b${escapeRegExp(other.display)}\\b`, "i").test(sentence)
      )
      .map((other) => other.display);
    if (pool.length < 3) continue;
    candidates.push({
      key: `cloze:${term.term}`,
      sourceKey: sourceKeyOf(sentence),
      score: 70 + term.score,
      type: "fill-blank",
      prompt: truncate(blanked, 300),
      correct: term.display,
      distractors: pool,
      explanation: truncate(sentence, 260),
      hint: `It ${term.proper ? "is a name or proper noun" : `starts with “${term.display.slice(0, 2)}”`} mentioned ${term.count} time${term.count === 1 ? "" : "s"}.`,
      topic: term.display,
      difficulty: term.proper ? "medium" : "easy",
    });
  }
  return candidates;
}

function buildNumericCandidates(sentences, rand) {
  const candidates = [];
  const seen = new Set();
  for (const sentence of sentences) {
    if (candidates.length >= 20) break;
    const matches = sentence.match(NUMBER_RE);
    if (!matches?.length) continue;
    const target = matches.find((m) => m.length > 1 && !seen.has(m));
    if (!target) continue;
    const distractors = perturbNumber(target, rand);
    if (distractors.length < 3) continue;
    seen.add(target);
    const blanked = sentence.replace(target, "＿＿＿＿");
    candidates.push({
      key: `num:${sentence.slice(0, 40)}:${target}`,
      sourceKey: sourceKeyOf(sentence),
      score: 60 + Math.min(sentence.length / 20, 8),
      type: "fill-blank",
      prompt: `Fill in the missing figure: ${truncate(blanked, 260)}`,
      correct: target,
      distractors,
      explanation: truncate(sentence, 260),
      hint: "Check the exact figure quoted in the source text.",
      topic: "Key figures",
      difficulty: "hard",
    });
  }
  return candidates;
}

function buildWhichTrueCandidates(sentences, terms, rand) {
  const candidates = [];
  const pool = sentences.filter((s) => s.length < 200 && isStandalone(s));
  for (let i = 0; i < pool.length && candidates.length < 20; i++) {
    const truth = pool[i];
    const distractors = [];
    for (let j = 1; j <= 8 && distractors.length < 3; j++) {
      const other = pool[(i + j * 3 + 1) % pool.length];
      if (!other || other === truth || similarity(other, truth) > 0.6) continue;
      const corrupted = corruptSentence(other, terms, rand);
      if (corrupted && corrupted !== other)
        distractors.push(truncate(sentenceCase(corrupted), 170));
    }
    if (distractors.length < 3) continue;
    candidates.push({
      key: `which:${truth.slice(0, 48)}`,
      sourceKey: sourceKeyOf(truth),
      score: 55 + rand() * 10,
      type: "which-true",
      prompt: "Which of these statements matches the uploaded material?",
      correct: truncate(sentenceCase(truth), 170),
      distractors,
      explanation: `The document states: “${truncate(truth, 240)}”`,
      hint: "Three options contain a swapped name, number, or reversed claim.",
      topic: "Comprehension",
      difficulty: "hard",
    });
  }
  return candidates;
}

function buildTrueFalseCandidates(sentences, terms, rand) {
  const candidates = [];
  sentences.forEach((sentence, index) => {
    if (candidates.length >= 24) return;
    if (sentence.length > 220 || !isStandalone(sentence)) return;
    const makeFalse = index % 2 === 1;
    const corrupted = makeFalse ? corruptSentence(sentence, terms, rand) : null;
    const statement = corrupted ?? sentence;
    const isTrue = !corrupted;
    candidates.push({
      key: `tf:${sentence.slice(0, 48)}`,
      sourceKey: sourceKeyOf(sentence),
      score: 40 + rand() * 12,
      type: "true-false",
      prompt: `True or false — ${truncate(sentenceCase(statement), 220)}`,
      correct: isTrue ? "True" : "False",
      distractors: isTrue ? ["False"] : ["True"],
      explanation: isTrue
        ? `The document supports this: “${truncate(sentence, 220)}”`
        : `The original text says: “${truncate(sentence, 220)}”`,
      hint: "Watch for swapped names, flipped numbers, or reversed claims.",
      topic: "Fact check",
      difficulty: "easy",
    });
  });
  return candidates;
}

function toQuestion(candidate, rand, id) {
  const distractors = pickDistractors(candidate.correct, candidate.distractors, rand, 3);
  while (distractors.length < 3 && candidate.type !== "true-false") {
    distractors.push(`Option ${distractors.length + 1}`);
  }
  let options;
  if (candidate.type === "true-false") {
    options = [
      { id: "o0", text: "True" },
      { id: "o1", text: "False" },
    ];
  } else {
    const all = shuffle([candidate.correct, ...distractors.slice(0, 3)], rand);
    options = all.map((text, i) => ({ id: `o${i}`, text }));
  }
  const correctOptionId = options.find((o) => o.text === candidate.correct)?.id ?? options[0].id;
  const seconds =
    candidate.difficulty === "hard" ? 25 : candidate.difficulty === "medium" ? 20 : 15;
  const points =
    candidate.difficulty === "hard" ? 150 : candidate.difficulty === "medium" ? 120 : 100;
  return {
    id: `q${id}`,
    type: candidate.type,
    prompt: candidate.prompt,
    options,
    correctOptionId,
    explanation: candidate.explanation,
    hint: candidate.hint,
    topic: candidate.topic,
    difficulty: candidate.difficulty,
    seconds,
    points,
  };
}

function pickTitle(terms, sourceName) {
  const top = terms.filter((t) => t.proper || t.words > 1).slice(0, 3);
  if (top.length) return `${top[0].display} Quiz`;
  const base = sourceName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  return `${sentenceCase(base)} Quiz`;
}

function generateLocalQuiz(text, { count = 10, difficulty = "mixed", sourceName = "notes", variationSeed = "" }) {
  const cleaned = cleanText(text);
  const allSentences = splitSentences(cleaned).filter(isUsefulSentence);
  if (allSentences.length < 4) {
    throw new Error("Not enough useful sentences found. Try a longer or clearer document.");
  }
  const terms = extractTerms(allSentences);
  const seed = hashString(`${cleaned.slice(0, 2000)}|${variationSeed}`);
  const rand = mulberry32(seed);

  let candidates = [
    ...buildDefinitionCandidates(allSentences),
    ...buildClozeCandidates(allSentences, terms, rand),
    ...buildNumericCandidates(allSentences, rand),
    ...buildWhichTrueCandidates(allSentences, terms, rand),
    ...buildTrueFalseCandidates(allSentences, terms, rand),
  ];

  // Deduplicate by source sentence
  const seen = new Set();
  candidates = candidates.filter((c) => {
    if (seen.has(c.sourceKey)) return false;
    seen.add(c.sourceKey);
    return true;
  });

  if (difficulty !== "mixed") {
    candidates = candidates.filter((c) => c.difficulty === difficulty || difficulty === "easy");
  }

  candidates.sort((a, b) => b.score - a.score);
  const selected = candidates.slice(0, Math.max(count * 2, 12));
  const final = shuffle(selected, rand).slice(0, count);

  if (final.length < 3) {
    throw new Error("Could not generate enough questions. Provide more text content.");
  }

  const questions = final.map((c, i) => toQuestion(c, rand, i + 1));
  const keywords = terms.slice(0, 8).map((t) => t.display);

  return {
    engine: "local-nlp",
    title: pickTitle(terms, sourceName),
    subtitle: `Generated from ${sourceName} · ${questions.length} questions`,
    questions,
    keywords,
    wordCount: words(cleaned).length,
  };
}

module.exports = { generateLocalQuiz };
