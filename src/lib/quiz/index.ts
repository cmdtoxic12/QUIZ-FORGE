import type { QuizQuestion } from "@/db/schema";
import { generateLocalQuiz } from "./local-engine";
import { generateWithLlm, detectProvider } from "./llm";
import { cleanText, words } from "./text";

export type GenerateOptions = {
  text: string;
  count: number;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  sourceName: string;
};

export type GeneratedQuiz = {
  engine: string;
  title: string;
  subtitle: string;
  questions: QuizQuestion[];
  keywords: string[];
  wordCount: number;
};

export const hasLlm = () => detectProvider() !== null;

export async function generateQuiz(
  options: GenerateOptions,
): Promise<GeneratedQuiz> {
  const text = cleanText(options.text);
  const wordCount = words(text).length;

  if (wordCount < 60) {
    throw new Error(
      "Your document is too short — upload something with at least a few paragraphs of text.",
    );
  }

  const local = generateLocalQuiz(text, options);

  const llm = await generateWithLlm(
    text,
    options.count,
    options.difficulty,
    local.title,
  );
  if (llm) {
    return {
      engine: llm.engine,
      title: llm.title,
      subtitle: llm.subtitle || local.subtitle,
      questions: llm.questions.slice(0, options.count),
      keywords: llm.keywords.length ? llm.keywords : local.keywords,
      wordCount,
    };
  }

  return {
    engine: "local-nlp",
    title: local.title,
    subtitle: local.subtitle,
    questions: local.questions,
    keywords: local.keywords,
    wordCount,
  };
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(length = 6) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}
