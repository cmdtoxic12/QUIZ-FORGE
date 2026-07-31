import type { QuizQuestion } from "@/db/schema";
import {
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
  type TermStats,
} from "./text";

export type Candidate = {
  key: string;
  sourceKey: string;
  /** 0..1 position of the source sentence in the document (for coverage). */
  position: number;
  score: number;
  type: QuizQuestion["type"];
  prompt: string;
  correct: string;
  distractors: string[];
  explanation: string;
  hint: string;
  topic: string;
  difficulty: QuizQuestion["difficulty"];
};

const PRONOUN_START =
  /^(it|its|it's|they|their|them|these|those|this|that|he|she|his|her|there|such|both|each|one|another|other|many|most|some|however|therefore|thus|also|finally|meanwhile|instead)\b/i;

/** Statements shown standalone must not lean on a previous sentence for context. */
function isStandalone(sentence: string) {
  return !PRONOUN_START.test(sentence.trim());
}

function sourceKeyOf(sentence: string) {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 70);
}

function positionOf(sentence: string, indexMap: Map<string, number>): number {
  return indexMap.get(sourceKeyOf(sentence)) ?? 0.5;
}

const ANTONYMS: Record<string, string> = {
  increase: "decrease",
  increases: "decreases",
  increased: "decreased",
  decrease: "increase",
  decreases: "increases",
  decreased: "increased",
  higher: "lower",
  lower: "higher",
  more: "less",
  less: "more",
  always: "never",
  never: "always",
  all: "none",
  none: "all",
  before: "after",
  after: "before",
  positive: "negative",
  negative: "positive",
  major: "minor",
  minor: "major",
  first: "last",
  last: "first",
  large: "small",
  small: "large",
  fast: "slow",
  slow: "fast",
  above: "below",
  below: "above",
  internal: "external",
  external: "internal",
  required: "optional",
  optional: "required",
  public: "private",
  private: "public",
};

const NEGATIONS: Array<[RegExp, string]> = [
  [/\bis not\b/, "is"],
  [/\bare not\b/, "are"],
  [/\bcannot\b/, "can"],
  [/\bis\b/, "is not"],
  [/\bare\b/, "are"],
  [/\bwas\b/, "was not"],
  [/\bwere\b/, "were not"],
  [/\bcan\b/, "cannot"],
  [/\bmust\b/, "must not"],
];

const NUMBER_RE = /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?%?\b|\b\d+(?:\.\d+)?%?\b/g;

function perturbNumber(raw: string, rand: () => number): string[] {
  const suffix = raw.endsWith("%") ? "%" : "";
  const core = raw.replace(/%$/, "").replace(/,/g, "");
  const value = Number(core);
  if (!Number.isFinite(value)) return [];
  const decimals = core.includes(".") ? core.split(".")[1].length : 0;
  const isYear = decimals === 0 && value > 1400 && value < 2200;

  const candidates = new Set<string>();
  const deltas = isYear
    ? [-11, -6, -3, 2, 5, 9, 14]
    : [0.5, 0.65, 0.8, 1.25, 1.5, 2, 3];

  for (const delta of shuffle(deltas, rand)) {
    const next = isYear ? value + delta : value * delta;
    if (next <= 0 || !Number.isFinite(next)) continue;
    const rounded = decimals
      ? next.toFixed(decimals)
      : Math.round(next).toString();
    if (rounded === core) continue;
    const formatted = raw.includes(",")
      ? Number(rounded).toLocaleString("en-US")
      : rounded;
    candidates.add(`${formatted}${suffix}`);
    if (candidates.size >= 5) break;
  }
  return [...candidates];
}

function corruptSentence(
  sentence: string,
  terms: TermStats[],
  rand: () => number,
): string | null {
  const properTerms = terms.filter((t) => t.proper && t.display.length > 3);

  // 1. Swap a named entity for a different one from the same document.
  for (const term of shuffle(properTerms.slice(0, 24), rand)) {
    const re = new RegExp(`\\b${escapeRegExp(term.display)}\\b`);
    if (!re.test(sentence)) continue;
    const pool = properTerms.filter(
      (other) =>
        other.term !== term.term &&
        !other.term.includes(term.term) &&
        !term.term.includes(other.term) &&
        !new RegExp(`\\b${escapeRegExp(other.display)}\\b`, "i").test(
          sentence,
        ) &&
        Math.abs(other.words - term.words) <= 1,
    );
    if (pool.length)
      return sentence.replace(re, shuffle(pool, rand)[0].display);
  }

  // 2. Flip a number.
  const numbers = sentence.match(NUMBER_RE);
  if (numbers?.length) {
    const target = numbers[0];
    const options = perturbNumber(target, rand);
    if (options.length) {
      return sentence.replace(target, options[0]);
    }
  }

  // 3. Swap an antonym.
  for (const [word, opposite] of Object.entries(ANTONYMS)) {
    const re = new RegExp(`\\b${word}\\b`, "i");
    if (re.test(sentence)) return sentence.replace(re, opposite);
  }

  // 4. Negate.
  for (const [re, replacement] of NEGATIONS) {
    if (re.test(sentence)) return sentence.replace(re, replacement);
  }

  return null;
}

function pickDistractors(
  correct: string,
  pool: string[],
  rand: () => number,
  count = 3,
): string[] {
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

  return shuffle(scored, rand)
    .slice(0, count)
    .map((entry) => entry.option);
}

const DEFINITION_RE =
  /^(?:The|A|An)?\s*([A-Z][A-Za-z0-9'’-]*(?:[\s-][A-Za-z0-9'’-]+){0,3})\s+(?:is|are|was|were|refers to|means|describes|represents|is defined as|is known as|can be described as)\s+(?:a|an|the)?\s*(.{25,200})$/;

function buildDefinitionCandidates(
  sentences: string[],
  rand: () => number,
): Candidate[] {
  const pairs: Array<{ term: string; definition: string; source: string }> = [];
  for (const sentence of sentences) {
    const match = sentence.match(DEFINITION_RE);
    if (!match) continue;
    const term = match[1].trim();
    const definition = sentenceCase(match[2].replace(/\.$/, ""));
    if (term.split(/\s+/).length > 4 || definition.split(/\s+/).length < 5)
      continue;
    if (PRONOUN_START.test(term)) continue;
    if (pairs.some((p) => p.term.toLowerCase() === term.toLowerCase()))
      continue;
    pairs.push({
      term,
      definition: truncate(definition, 150),
      source: sentence,
    });
  }

  return pairs
    .map((pair, index) => {
      const pool = pairs
        .filter((p) => p.term !== pair.term)
        .map((p) => p.definition);
      return {
        key: `def:${pair.term.toLowerCase()}`,
        sourceKey: sourceKeyOf(pair.source),
        position: 0.5,
        score: 90 - index + pair.definition.length / 40,
        type: "multiple-choice" as const,
        prompt: `According to the document, what best describes “${pair.term}”?`,
        correct: pair.definition,
        distractors: pool,
        explanation: truncate(pair.source, 260),
        hint: `Look for where the document defines ${pair.term}.`,
        topic: pair.term,
        difficulty: "medium" as const,
      };
    })
    .filter((c) => c.distractors.length >= 2);
}

function buildClozeCandidates(
  sentences: string[],
  terms: TermStats[],
  rand: () => number,
): Candidate[] {
  const candidates: Candidate[] = [];
  const used = new Set<string>();
  const topTerms = terms.slice(0, 60);

  for (const term of topTerms) {
    if (candidates.length >= 40) break;
    if (used.has(term.term)) continue;
    const re = new RegExp(`\\b${escapeRegExp(term.display)}\\b`, "i");

    const sentence = sentences.find((s) => {
      if (!re.test(s)) return false;
      const w = words(s);
      if (w.length < 10) return false;
      const occurrences =
        s.match(new RegExp(`\\b${escapeRegExp(term.display)}\\b`, "gi"))
          ?.length ?? 0;
      return (
        occurrences === 1 &&
        !s.toLowerCase().startsWith(term.term.toLowerCase())
      );
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
          !new RegExp(`\\b${escapeRegExp(other.display)}\\b`, "i").test(
            sentence,
          ),
      )
      .map((other) => other.display);

    if (pool.length < 3) continue;

    candidates.push({
      key: `cloze:${term.term}`,
      sourceKey: sourceKeyOf(sentence),
      position: 0.5,
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

function buildNumericCandidates(
  sentences: string[],
  rand: () => number,
): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();

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
      position: 0.5,
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

function buildWhichTrueCandidates(
  sentences: string[],
  terms: TermStats[],
  rand: () => number,
): Candidate[] {
  const candidates: Candidate[] = [];
  const pool = sentences.filter((s) => s.length < 200 && isStandalone(s));

  for (let i = 0; i < pool.length && candidates.length < 20; i += 1) {
    const truth = pool[i];
    const distractors: string[] = [];
    for (let j = 1; j <= 8 && distractors.length < 3; j += 1) {
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
      position: 0.5,
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

function buildTrueFalseCandidates(
  sentences: string[],
  terms: TermStats[],
  rand: () => number,
): Candidate[] {
  const candidates: Candidate[] = [];

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
      position: 0.5,
      score: 40 + rand() * 12,
      type: "true-false",
      prompt: `True or false — ${truncate(sentenceCase(statement), 220)}`,
      correct: isTrue ? "True" : "False",
      distractors: [isTrue ? "False" : "True"],
      explanation: isTrue
        ? `Correct — the document says: “${truncate(sentence, 220)}”`
        : `False. The document actually says: “${truncate(sentence, 220)}”`,
      hint: isTrue
        ? "This one reads exactly like the source."
        : "Something here was quietly swapped out.",
      topic: "Fact check",
      difficulty: "easy",
    });
  });

  return candidates;
}

const DIFFICULTY_META: Record<
  QuizQuestion["difficulty"],
  { points: number; seconds: number }
> = {
  easy: { points: 100, seconds: 20 },
  medium: { points: 150, seconds: 25 },
  hard: { points: 200, seconds: 30 },
};

export type LocalQuizResult = {
  title: string;
  subtitle: string;
  questions: QuizQuestion[];
  keywords: string[];
  wordCount: number;
};

export function generateLocalQuiz(
  rawText: string,
  options: {
    count: number;
    difficulty: "easy" | "medium" | "hard" | "mixed";
    sourceName: string;
  },
): LocalQuizResult {
  const text = cleanText(rawText);
  const rand = mulberry32(hashString(text.slice(0, 4000)) || 12345);
  const allSentences = splitSentences(text);
  const sentences = allSentences.filter(isUsefulSentence);
  const indexMap = new Map<string, number>();
  const poolForIndex = sentences.length ? sentences : allSentences;
  poolForIndex.forEach((sent, i) => {
    const key = sourceKeyOf(sent);
    if (!indexMap.has(key)) {
      indexMap.set(
        key,
        poolForIndex.length <= 1 ? 0.5 : i / (poolForIndex.length - 1),
      );
    }
  });
  const terms = extractTerms(sentences.length ? sentences : allSentences);
  const wordCount = words(text).length;

  if (sentences.length < 3) {
    throw new Error(
      "That document didn't contain enough readable prose to build a quiz. Try a file with more full sentences.",
    );
  }

  const buckets: Record<string, Candidate[]> = {
    definition: buildDefinitionCandidates(sentences, rand),
    cloze: buildClozeCandidates(sentences, terms, rand),
    numeric: buildNumericCandidates(sentences, rand),
    which: buildWhichTrueCandidates(sentences, terms, rand),
    tf: buildTrueFalseCandidates(sentences, terms, rand),
  };

  // Attach document position and lightly boost underrepresented regions.
  for (const key of Object.keys(buckets)) {
    for (const c of buckets[key]) {
      if (c.position === undefined || c.position === 0.5) {
        c.position = indexMap.get(c.sourceKey) ?? 0.5;
      }
    }
    buckets[key] = buckets[key].sort((a, b) => b.score - a.score);
  }

  const difficultyFilter = (c: Candidate) => {
    if (options.difficulty === "mixed") return true;
    if (options.difficulty === "easy") return c.difficulty !== "hard";
    if (options.difficulty === "hard") return c.difficulty !== "easy";
    return true;
  };

  const order = ["definition", "cloze", "which", "numeric", "tf"];
  const selected: Candidate[] = [];
  const seenKeys = new Set<string>();
  const seenAnswers = new Set<string>();
  const seenSources = new Set<string>();
  const deferred: Candidate[] = [];

  const bandOf = (c: Candidate) =>
    c.position < 0.33 ? 0 : c.position < 0.66 ? 1 : 2;
  const bandCounts = [0, 0, 0];

  const accept = (candidate: Candidate, allowSourceReuse: boolean) => {
    if (seenKeys.has(candidate.key)) return false;
    if (!difficultyFilter(candidate)) return false;
    if (!allowSourceReuse && seenSources.has(candidate.sourceKey)) return false;
    const answerKey = `${candidate.type}:${candidate.correct.toLowerCase()}`;
    if (candidate.type !== "true-false" && seenAnswers.has(answerKey))
      return false;
    if (selected.some((s) => similarity(s.prompt, candidate.prompt) > 0.8))
      return false;
    seenKeys.add(candidate.key);
    seenAnswers.add(answerKey);
    seenSources.add(candidate.sourceKey);
    bandCounts[bandOf(candidate)] += 1;
    selected.push(candidate);
    return true;
  };

  // Prefer candidates from the least-covered third of the document.
  let guard = 0;
  while (selected.length < options.count && guard < 800) {
    guard += 1;
    let progressed = false;
    const targetBand = bandCounts.indexOf(Math.min(...bandCounts));
    for (const bucket of order) {
      const list = buckets[bucket];
      // First try a candidate from the under-covered band
      const preferIdx = list.findIndex((c) => bandOf(c) === targetBand);
      const tryOrder =
        preferIdx >= 0
          ? [preferIdx, ...list.map((_, i) => i).filter((i) => i !== preferIdx)]
          : list.map((_, i) => i);
      for (const idx of tryOrder) {
        const candidate = list[idx];
        if (!candidate) continue;
        if (
          seenSources.has(candidate.sourceKey) &&
          !seenKeys.has(candidate.key)
        ) {
          deferred.push(candidate);
          list.splice(idx, 1);
          progressed = true;
          break;
        }
        if (accept(candidate, false)) {
          list.splice(idx, 1);
          progressed = true;
          break;
        }
        // Reject permanently for this pass
        list.splice(idx, 1);
        progressed = true;
        break;
      }
      if (selected.length >= options.count) break;
    }
    if (!progressed) break;
  }

  // If a short document runs dry, allow reusing source sentences for other angles.
  while (selected.length < options.count && deferred.length) {
    accept(deferred.shift()!, true);
  }

  if (!selected.length) {
    throw new Error(
      "Could not build questions from this document. Try a longer or more detailed file.",
    );
  }

  const questions: QuizQuestion[] = selected.map((candidate, index) => {
    const distractorCount = candidate.type === "true-false" ? 1 : 3;
    const distractors =
      candidate.type === "true-false"
        ? candidate.distractors
        : pickDistractors(
            candidate.correct,
            candidate.distractors,
            rand,
            distractorCount,
          );

    const rawOptions = [candidate.correct, ...distractors];
    const finalOptions =
      candidate.type === "true-false"
        ? ["True", "False"]
        : shuffle(rawOptions, rand);

    const optionObjects = finalOptions.map((text, i) => ({
      id: `o${i}`,
      text,
    }));
    const correctOption =
      optionObjects.find(
        (o) => o.text.toLowerCase() === candidate.correct.toLowerCase(),
      ) ?? optionObjects[0];

    const meta = DIFFICULTY_META[candidate.difficulty];

    return {
      id: `q${index + 1}`,
      type: candidate.type,
      prompt: candidate.prompt,
      options: optionObjects,
      correctOptionId: correctOption.id,
      explanation: candidate.explanation,
      hint: candidate.hint,
      difficulty: candidate.difficulty,
      points: meta.points,
      seconds: meta.seconds,
      topic: candidate.topic,
    };
  });

  const keywords = terms
    .filter((t) => t.display.length > 3)
    .slice(0, 10)
    .map((t) => t.display);

  const headline =
    terms.find((t) => t.words > 1)?.display ??
    terms[0]?.display ??
    options.sourceName.replace(/\.[^.]+$/, "");

  return {
    title: `${headline} Challenge`,
    subtitle: `${questions.length} questions generated from ${options.sourceName}`,
    questions,
    keywords,
    wordCount,
  };
}
