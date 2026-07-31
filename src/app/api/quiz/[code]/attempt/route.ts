import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts, quizzes } from "@/db/schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  const { code } = await context.params;
  const [quiz] = await db.select().from(quizzes).where(eq(quizzes.code, code)).limit(1);
  if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

  const rows = await db
    .select()
    .from(attempts)
    .where(eq(attempts.quizId, quiz.id))
    .orderBy(desc(attempts.score), desc(attempts.createdAt))
    .limit(15);

  return NextResponse.json({ leaderboard: rows });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const { code } = await context.params;
    const body = (await request.json()) as {
      playerName?: string;
      score?: number;
      correct?: number;
      total?: number;
      maxStreak?: number;
      durationMs?: number;
    };

    const [quiz] = await db.select().from(quizzes).where(eq(quizzes.code, code)).limit(1);
    if (!quiz) return NextResponse.json({ error: "Quiz not found" }, { status: 404 });

    const total = Math.max(0, Math.floor(body.total ?? 0));
    const correct = Math.min(Math.max(0, Math.floor(body.correct ?? 0)), total || 999);
    const name = (body.playerName ?? "Anonymous").toString().trim().slice(0, 40) || "Anonymous";

    const [row] = await db
      .insert(attempts)
      .values({
        quizId: quiz.id,
        playerName: name,
        score: Math.max(0, Math.floor(body.score ?? 0)),
        correct,
        total,
        accuracy: total ? correct / total : 0,
        maxStreak: Math.max(0, Math.floor(body.maxStreak ?? 0)),
        durationMs: Math.max(0, Math.floor(body.durationMs ?? 0)),
      })
      .returning();

    await db
      .update(quizzes)
      .set({ plays: sql`${quizzes.plays} + 1` })
      .where(eq(quizzes.id, quiz.id));

    const leaderboard = await db
      .select()
      .from(attempts)
      .where(eq(attempts.quizId, quiz.id))
      .orderBy(desc(attempts.score), desc(attempts.createdAt))
      .limit(15);

    const rank = leaderboard.findIndex((entry) => entry.id === row.id) + 1;

    return NextResponse.json({ attempt: row, leaderboard, rank: rank || null });
  } catch (error) {
    console.error("attempt error", error);
    return NextResponse.json({ error: "Could not save your score." }, { status: 500 });
  }
}
