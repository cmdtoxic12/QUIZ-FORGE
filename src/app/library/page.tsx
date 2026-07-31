import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attempts, quizzes } from "@/db/schema";

export const dynamic = "force-dynamic";

type LibraryRow = {
  code: string;
  title: string;
  subtitle: string;
  questionCount: number;
  difficulty: string;
  keywords: string[];
  plays: number;
  createdAt: Date;
  topScore: number | null;
  topPlayer: string | null;
};

async function loadLibrary(): Promise<LibraryRow[]> {
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
        topScore: sql<number | null>`max(${attempts.score})`,
        topPlayer: sql<string | null>`(array_agg(${attempts.playerName} order by ${attempts.score} desc))[1]`,
      })
      .from(quizzes)
      .leftJoin(attempts, eq(attempts.quizId, quizzes.id))
      .groupBy(quizzes.id)
      .orderBy(desc(quizzes.createdAt))
      .limit(30);
    return rows;
  } catch {
    return [];
  }
}

export default async function LibraryPage() {
  const rows = await loadLibrary();

  return (
    <div className="space-y-8">
      <header className="animate-slide">
        <h1 className="text-4xl font-black tracking-tight">
          Quiz <span className="text-gradient">library</span>
        </h1>
        <p className="mt-2 text-white/55">
          Every quiz the agent has forged. Share a link and see who tops the board.
        </p>
      </header>

      {rows.length === 0 ? (
        <div className="glass rounded-3xl p-12 text-center">
          <div className="animate-float text-5xl">🗂️</div>
          <p className="mt-4 text-lg font-bold">No quizzes yet</p>
          <p className="mt-1 text-sm text-white/55">
            Upload a document and the agent will build your first game.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 px-6 py-3 text-sm font-black text-white transition hover:brightness-110"
          >
            Create a quiz →
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link
              key={row.code}
              href={`/play/${row.code}`}
              className="glass group flex flex-col rounded-2xl p-5 transition hover:-translate-y-1 hover:border-violet-400/50"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full border border-white/12 bg-white/5 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-white/50">
                  {row.difficulty}
                </span>
                <span className="font-mono text-[11px] text-white/35">#{row.code}</span>
              </div>
              <p className="mt-3 line-clamp-2 text-lg font-black leading-snug">{row.title}</p>
              <p className="mt-1 line-clamp-2 text-xs text-white/50">{row.subtitle}</p>

              {row.keywords?.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {row.keywords.slice(0, 3).map((k) => (
                    <span
                      key={k}
                      className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] font-semibold text-white/60"
                    >
                      {k}
                    </span>
                  ))}
                </div>
              )}

              <div className="mt-auto flex items-center justify-between pt-4 text-xs text-white/50">
                <span>
                  {row.questionCount} Qs · {row.plays} plays
                </span>
                {row.topScore ? (
                  <span className="font-bold text-amber-300">
                    🏆 {row.topPlayer} {row.topScore.toLocaleString()}
                  </span>
                ) : (
                  <span className="font-bold text-cyan-300 transition group-hover:translate-x-0.5">
                    Be first →
                  </span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
