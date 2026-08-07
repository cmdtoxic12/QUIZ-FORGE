/** Text utilities + local NLP helpers (ported from QuizForge) */

const STOPWORDS = new Set(
  `a about above after again against all am an and any are aren't as at be because been before being below
  between both but by can cannot could couldn't did didn't do does doesn't doing don't down during each few for
  from further had hadn't has hasn't have haven't having he he'd he'll he's her here here's hers herself him
  himself his how how's i i'd i'll i'm i've if in into is isn't it it's its itself let's me more most mustn't my
  myself no nor not of off on once only or other ought our ours ourselves out over own same shan't she she'd
  she'll she's should shouldn't so some such than that that's the their theirs them themselves then there
  there's these they they'd they'll they're they've this those through to too under until up very was wasn't we
  we'd we'll we're we've were weren't what what's when when's where where's which while who who's whom why why's
  with won't would wouldn't you you'd you'll you're you've your yours yourself yourselves also may might must
  shall will using used use often within upon whose many much every another via etc ie eg however therefore thus
  hence although though because since while whereas among amongst per across along around behind beyond`
    .split(/\s+/)
    .filter(Boolean)
);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffle(items, rand) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cleanText(raw) {
  return raw
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/\n{2,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc",
  "e.g", "i.e", "fig", "no", "approx", "inc", "ltd", "co", "dept", "eq", "al",
]);

function splitSentences(text) {
  const chunks = text.split(/\n{2,}|\n(?=[-*•\d])/g);
  const sentences = [];
  for (const chunk of chunks) {
    const flat = chunk.replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();
    if (!flat) continue;
    let buffer = "";
    const parts = flat.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      const candidate = buffer ? `${buffer} ${part}` : part;
      const lastWord = candidate
        .replace(/[)"']+$/, "")
        .split(/\s+/)
        .pop()
        .replace(/\.$/, "")
        .toLowerCase();
      if (ABBREVIATIONS.has(lastWord) || /\b[A-Z]$/.test(candidate.replace(/\.$/, ""))) {
        buffer = candidate;
        continue;
      }
      buffer = "";
      sentences.push(candidate.trim());
    }
    if (buffer.trim()) sentences.push(buffer.trim());
  }
  return sentences
    .map((s) => s.replace(/^[-*•\s]+/, "").trim())
    .filter(Boolean);
}

function words(text) {
  return text.match(/[A-Za-z][A-Za-z'-]*|\d[\d.,%/$-]*/g) ?? [];
}

function isUsefulSentence(sentence) {
  const w = words(sentence);
  if (w.length < 7 || w.length > 60) return false;
  if (sentence.length < 45 || sentence.length > 340) return false;
  const letters = sentence.replace(/[^A-Za-z]/g, "").length;
  if (letters / sentence.length < 0.55) return false;
  const upper = sentence.replace(/[^A-Z]/g, "").length;
  if (upper / Math.max(letters, 1) > 0.5) return false;
  if (/^(table|figure|chapter|contents|page|copyright|http|www)/i.test(sentence)) return false;
  if (/[|]{2,}|_{4,}|\.{4,}/.test(sentence)) return false;
  if ((sentence.match(/\d/g)?.length ?? 0) / sentence.length > 0.3) return false;
  return true;
}

function extractTerms(sentences) {
  const uni = new Map();
  const phrases = new Map();

  for (const sentence of sentences) {
    const tokens = sentence.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
    tokens.forEach((token, index) => {
      const key = token.toLowerCase();
      if (key.length < 4 || STOPWORDS.has(key)) return;
      const entry = uni.get(key) ?? { display: token, count: 0, proper: 0 };
      entry.count += 1;
      if (index > 0 && /^[A-Z]/.test(token)) {
        entry.proper += 1;
        entry.display = token;
      }
      uni.set(key, entry);
    });

    const phraseMatches =
      sentence.match(
        /\b(?:[A-Z][A-Za-z0-9'’-]+)(?:\s+(?:of|the|and|for|de)?\s*[A-Z][A-Za-z0-9'’-]+){1,3}\b/g
      ) ?? [];
    for (const phrase of phraseMatches) {
      if (sentence.startsWith(phrase)) continue;
      const key = phrase.toLowerCase();
      const entry = phrases.get(key) ?? { display: phrase, count: 0 };
      entry.count += 1;
      phrases.set(key, entry);
    }
  }

  const stats = [];
  for (const [term, entry] of uni) {
    const proper = entry.proper > entry.count / 2;
    const lengthBoost = Math.min(term.length / 6, 2);
    stats.push({
      term,
      display: entry.display,
      count: entry.count,
      words: 1,
      proper,
      score: entry.count * (proper ? 2.1 : 1) * lengthBoost,
    });
  }
  for (const [term, entry] of phrases) {
    stats.push({
      term,
      display: entry.display,
      count: entry.count,
      words: entry.display.split(/\s+/).length,
      proper: true,
      score: entry.count * 3.2 + entry.display.length / 8,
    });
  }
  return stats.sort((a, b) => b.score - a.score);
}

function truncate(text, max = 220) {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).replace(/[\s,;:]+\S*$/, "")}…`;
}

function sentenceCase(text) {
  const clean = text.trim().replace(/^[,;:\-–—\s]+/, "").replace(/[,;:]+$/, "");
  if (!clean) return clean;
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function similarity(a, b) {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  let shared = 0;
  for (const token of setA) if (setB.has(token)) shared += 1;
  return shared / Math.max(setA.size, setB.size, 1);
}

function sampleAcrossDocument(raw, maxChars = 100000) {
  const text = raw.trim();
  if (text.length <= maxChars) return text;
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length < 4) {
    const window = Math.floor(maxChars / 5);
    const positions = [0, 0.25, 0.5, 0.75, 1];
    const parts = [];
    for (const p of positions) {
      const start =
        p === 1
          ? Math.max(0, text.length - window)
          : Math.min(Math.floor(text.length * p), Math.max(0, text.length - window));
      parts.push(text.slice(start, start + window));
    }
    return parts.join("\n\n");
  }
  const bands = 5;
  const bandSize = Math.ceil(paragraphs.length / bands);
  const budgetPerBand = Math.floor(maxChars / bands);
  const picked = [];
  for (let b = 0; b < bands; b++) {
    const slice = paragraphs.slice(b * bandSize, (b + 1) * bandSize);
    let used = 0;
    for (const para of slice) {
      if (used >= budgetPerBand) break;
      if (para.length > budgetPerBand && used === 0) {
        picked.push(para.slice(0, budgetPerBand));
        used = budgetPerBand;
        break;
      }
      if (used + para.length + 2 > budgetPerBand && used > 0) break;
      picked.push(para);
      used += para.length + 2;
    }
  }
  const merged = picked.join("\n\n");
  return merged.length > maxChars ? merged.slice(0, maxChars) : merged;
}

module.exports = {
  STOPWORDS,
  mulberry32,
  hashString,
  shuffle,
  cleanText,
  splitSentences,
  words,
  isUsefulSentence,
  extractTerms,
  truncate,
  sentenceCase,
  escapeRegExp,
  similarity,
  sampleAcrossDocument,
};
