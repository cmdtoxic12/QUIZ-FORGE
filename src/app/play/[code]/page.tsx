import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { quizzes } from "@/db/schema";
import QuizGame, { type GameQuiz } from "@/components/QuizGame";

export const dynamic = "force-dynamic";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  let row: typeof quizzes.$inferSelect | undefined;
  try {
    [row] = await db.select().from(quizzes).where(eq(quizzes.code, code)).limit(1);
  } catch {
    row = undefined;
  }

  if (!row || !Array.isArray(row.questions) || row.questions.length === 0) {
    notFound();
  }

  const quiz: GameQuiz = {
    code: row.code,
    title: row.title,
    subtitle: row.subtitle || `${row.questionCount} questions from your upload`,
    engine: row.engine,
    difficulty: row.difficulty,
    keywords: row.keywords ?? [],
    sourceNames: row.sourceNames ?? [],
    wordCount: row.wordCount,
    questions: row.questions,
  };

  return <QuizGame quiz={quiz} />;
}
