import { NextResponse } from "next/server";
import { db } from "@/db";
import { quizzes } from "@/db/schema";
import { extractText, isSupported } from "@/lib/extract";
import { generateQuiz, hasLlm, makeCode } from "@/lib/quiz";
import { sampleAcrossDocument } from "@/lib/quiz/text";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_SOURCE_CHARS = 140_000;

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    const pasted = (form.get("text") as string | null)?.trim() ?? "";
    const count = Math.min(
      Math.max(Number(form.get("count") ?? 10) || 10, 5),
      20,
    );
    const difficultyRaw = String(form.get("difficulty") ?? "mixed");
    const difficulty = (["easy", "medium", "hard", "mixed"] as const).includes(
      difficultyRaw as "easy" | "medium" | "hard" | "mixed",
    )
      ? (difficultyRaw as "easy" | "medium" | "hard" | "mixed")
      : "mixed";

    if (!files.length && !pasted) {
      return NextResponse.json(
        { error: "Upload at least one document or paste some text." },
        { status: 400 },
      );
    }

    const sourceNames: string[] = [];
    const chunks: string[] = [];

    for (const file of files) {
      if (file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: `"${file.name}" is larger than 12 MB.` },
          { status: 400 },
        );
      }
      if (!isSupported(file.name)) {
        return NextResponse.json(
          {
            error: `"${file.name}" isn't a supported format. Use PDF, DOCX, TXT, MD, CSV, JSON or HTML.`,
          },
          { status: 400 },
        );
      }
      const text = await extractText(file);
      if (text.trim().length > 40) {
        chunks.push(text);
        sourceNames.push(file.name);
      }
    }

    if (pasted) {
      chunks.push(pasted);
      sourceNames.push("pasted notes");
    }

    const merged = chunks.join("\n\n");
    if (merged.trim().length < 200) {
      return NextResponse.json(
        {
          error:
            "We couldn't read enough text out of that. Scanned or image-only PDFs aren't supported — try a text-based file.",
        },
        { status: 422 },
      );
    }

    // Sample start / middle / end so a long book is not reduced to chapter 1 only.
    const sampled = sampleAcrossDocument(merged, MAX_SOURCE_CHARS);

    const generated = await generateQuiz({
      text: sampled,
      count,
      difficulty,
      sourceName: sourceNames[0] ?? "your notes",
    });

    const code = makeCode(7);

    const [row] = await db
      .insert(quizzes)
      .values({
        code,
        title: generated.title,
        subtitle: generated.subtitle,
        sourceNames,
        engine: generated.engine,
        difficulty,
        questionCount: generated.questions.length,
        wordCount: generated.wordCount,
        keywords: generated.keywords,
        questions: generated.questions,
      })
      .returning({ code: quizzes.code, id: quizzes.id });

    return NextResponse.json({
      code: row.code,
      title: generated.title,
      questionCount: generated.questions.length,
      engine: generated.engine,
      llm: hasLlm(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Something went wrong while building your quiz.";
    console.error("generate error", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
