import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { quizzes } from "@/db/schema";
import { hasLlm } from "@/lib/quiz";
import QuizBuilder from "@/components/QuizBuilder";

export const dynamic = "force-dynamic";

async function recentQuizzes() {
  try {
    return await db
      .select({
        code: quizzes.code,
        title: quizzes.title,
        questionCount: quizzes.questionCount,
        plays: quizzes.plays,
        difficulty: quizzes.difficulty,
      })
      .from(quizzes)
      .orderBy(desc(quizzes.createdAt))
      .limit(4);
  } catch {
    return [];
  }
}

export default async function HomePage() {
  const recent = await recentQuizzes();
  const engineLabel = hasLlm() ? "LLM agent online" : "Local NLP agent online";

  return (
    <div className="space-y-16">
      <section className="grid items-center gap-10 pt-6 lg:grid-cols-[1.05fr_1fr]">
        <div className="animate-slide">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/5 px-3.5 py-1.5 text-xs font-bold text-white/70">
            <span className="h-2 w-2 animate-pulse rounded-full bg-lime-400" />
            {engineLabel}
          </span>
          <h1 className="mt-5 text-5xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            Turn any document into a{" "}
            <span className="text-gradient">quiz game</span> in seconds.
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-white/60">
            Drop in lecture notes, a research PDF, onboarding docs or a messy pile of markdown.
            The QuizForge agent reads it, mines the facts that matter, invents believable wrong
            answers, and hands you a timed arcade quiz with streaks, lifelines and a leaderboard.
          </p>

          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              { emoji: "📥", title: "Upload", body: "PDF, DOCX, TXT, MD, CSV, HTML or raw paste." },
              { emoji: "🧠", title: "Analyse", body: "Sentences ranked, entities and figures mined." },
              { emoji: "🕹️", title: "Play", body: "Timed rounds, combo streaks, instant replays." },
            ].map((step, i) => (
              <div
                key={step.title}
                className="glass rounded-2xl p-4"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <div className="text-2xl">{step.emoji}</div>
                <p className="mt-1.5 text-sm font-black">{step.title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/55">{step.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="animate-slide" style={{ animationDelay: "120ms" }}>
          <QuizBuilder />
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-24">
        <div className="mb-5 flex items-end justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight">What the agent actually does</h2>
            <p className="mt-1 text-sm text-white/55">
              Five question generators run over your text, then compete for a slot in the final game.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              emoji: "📖",
              title: "Definition mining",
              body: "Finds “X is / refers to / means Y” patterns and turns them into concept questions with rival definitions as decoys.",
            },
            {
              emoji: "🧩",
              title: "Cloze deletion",
              body: "Ranks salient terms by frequency and proper-noun weight, then blanks them out of a real sentence.",
            },
            {
              emoji: "🔢",
              title: "Figure hunting",
              body: "Grabs statistics, dates and percentages and generates near-miss numeric distractors.",
            },
            {
              emoji: "🕵️",
              title: "Truth spotting",
              body: "Corrupts sentences by swapping entities or flipping claims — only one option survives verbatim.",
            },
            {
              emoji: "⚖️",
              title: "Fact check rounds",
              body: "Fast true/false statements with quiet entity swaps and negations to catch skim-readers.",
            },
            {
              emoji: "🎚️",
              title: "Difficulty curve",
              body: "Candidates are scored, de-duplicated and interleaved so no two questions feel the same.",
            },
          ].map((card) => (
            <div
              key={card.title}
              className="glass rounded-2xl p-5 transition hover:-translate-y-1 hover:border-violet-400/40"
            >
              <div className="text-2xl">{card.emoji}</div>
              <p className="mt-2 text-base font-black">{card.title}</p>
              <p className="mt-1 text-sm leading-relaxed text-white/55">{card.body}</p>
            </div>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <div className="mb-5 flex items-end justify-between">
            <h2 className="text-2xl font-black tracking-tight">Recently forged</h2>
            <Link
              href="/library"
              className="text-sm font-bold text-cyan-300 transition hover:text-cyan-200"
            >
              View library →
            </Link>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {recent.map((quiz) => (
              <Link
                key={quiz.code}
                href={`/play/${quiz.code}`}
                className="glass group rounded-2xl p-5 transition hover:-translate-y-1 hover:border-cyan-300/50"
              >
                <p className="text-xs font-black uppercase tracking-widest text-white/40">
                  {quiz.difficulty}
                </p>
                <p className="mt-1.5 line-clamp-2 text-base font-bold leading-snug">{quiz.title}</p>
                <p className="mt-3 text-xs text-white/50">
                  {quiz.questionCount} questions · {quiz.plays} plays
                </p>
                <span className="mt-3 inline-block text-sm font-bold text-cyan-300 transition group-hover:translate-x-1">
                  Play →
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
