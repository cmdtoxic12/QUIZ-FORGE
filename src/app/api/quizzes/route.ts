import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { quizzes } from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const rows = await db
      .select({
        code: quizzes.code,
        title: quizzes.title,
        subtitle: quizzes.subtitle,
        questionCount: quizzes.questionCount,
        difficulty: quizzes.difficulty,
        keywords: quizzes.keywords,
        plays: quizzes.plays,
        createdAt: quizzes.createdAt,
      })
      .from(quizzes)
      .orderBy(desc(quizzes.createdAt))
      .limit(9);
    return NextResponse.json({ quizzes: rows });
  } catch {
    return NextResponse.json({ quizzes: [] });
  }
}
