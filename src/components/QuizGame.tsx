"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { QuizQuestion } from "@/db/schema";
import Confetti from "./Confetti";

function shuffleArray<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function dealQuestions(source: QuizQuestion[]): QuizQuestion[] {
  return shuffleArray(source).map((question) => {
    const originalCorrectText = question.options.find((option) => option.id === question.correctOptionId)?.text;
    const shuffledOptions = shuffleArray(question.options).map((option, index) => ({
      ...option,
      id: `o${index}`,
    }));

    const matchedCorrect = shuffledOptions.find((option) => option.text === originalCorrectText);

    return {
      ...question,
      options: shuffledOptions,
      correctOptionId: matchedCorrect ? matchedCorrect.id : shuffledOptions[0]?.id ?? question.correctOptionId,
    };
  });
}

export type GameQuiz = {
  code: string;
  title: string;
  subtitle: string;
  engine: string;
  difficulty: string;
  keywords: string[];
  sourceNames: string[];
  wordCount: number;
  questions: QuizQuestion[];
};

type LeaderRow = {
  id: number;
  playerName: string;
  score: number;
  correct: number;
  total: number;
  maxStreak: number;
};

type Answer = {
  questionId: string;
  chosenId: string | null;
  correct: boolean;
  points: number;
  msUsed: number;
};

const LETTERS = ["A", "B", "C", "D", "E"];

const TYPE_LABEL: Record<QuizQuestion["type"], string> = {
  "multiple-choice": "Definition",
  "true-false": "Fact check",
  "fill-blank": "Fill the blank",
  "which-true": "Spot the truth",
};

const DIFF_COLOR: Record<QuizQuestion["difficulty"], string> = {
  easy: "text-lime-300 border-lime-300/40 bg-lime-400/10",
  medium: "text-cyan-300 border-cyan-300/40 bg-cyan-400/10",
  hard: "text-rose-300 border-rose-300/40 bg-rose-400/10",
};

function rankFor(accuracy: number) {
  if (accuracy >= 0.95) return { title: "Legendary Scholar", emoji: "👑", tone: "from-amber-300 to-yellow-500" };
  if (accuracy >= 0.8) return { title: "Document Whisperer", emoji: "🧠", tone: "from-violet-400 to-fuchsia-500" };
  if (accuracy >= 0.6) return { title: "Solid Skimmer", emoji: "📗", tone: "from-cyan-300 to-blue-500" };
  if (accuracy >= 0.4) return { title: "Casual Reader", emoji: "🙂", tone: "from-sky-300 to-indigo-400" };
  return { title: "Needs a Re-read", emoji: "🫠", tone: "from-rose-300 to-orange-400" };
}

function renderPrompt(prompt: string) {
  const parts = prompt.split(/(＿+)/g);
  return parts.map((part, i) =>
    part.startsWith("＿") ? (
      <span
        key={i}
        className="mx-1 inline-block min-w-[5rem] rounded-md border-b-2 border-cyan-300/80 bg-cyan-400/10 px-2 align-middle text-transparent"
      >
        blank
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

export default function QuizGame({ quiz }: { quiz: GameQuiz }) {
  const questions = quiz.questions;
  const [phase, setPhase] = useState<"intro" | "playing" | "reveal" | "results">("intro");
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [streak, setStreak] = useState(0);
  const [maxStreak, setMaxStreak] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [timeLeft, setTimeLeft] = useState(0);
  const [eliminated, setEliminated] = useState<string[]>([]);
  const [hintOpen, setHintOpen] = useState(false);
  const [lifelines, setLifelines] = useState({ fifty: 2, hint: 2, skip: 1 });
  const [pop, setPop] = useState<{ id: number; text: string; good: boolean } | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [playerName, setPlayerName] = useState("");
  const [leaderboard, setLeaderboard] = useState<LeaderRow[]>([]);
  const [saved, setSaved] = useState(false);
  const [savingRank, setSavingRank] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const startedAt = useRef<number>(0);
  const questionStart = useRef<number>(0);

  const question = questions[index];
  const total = questions.length;

  const beginQuestion = useCallback(
    (i: number) => {
      setChosen(null);
      setEliminated([]);
      setHintOpen(false);
      setTimeLeft(questions[i].seconds * 1000);
      questionStart.current = Date.now();
    },
    [questions],
  );

  const finish = useCallback((finalAnswers: Answer[], _finalScore: number) => {
    setAnswers(finalAnswers);
    setPhase("results");
    const correct = finalAnswers.filter((a) => a.correct).length;
    if (correct / Math.max(finalAnswers.length, 1) >= 0.7) {
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 4200);
    }
  }, []);

  const submitAnswer = useCallback(
    (optionId: string | null) => {
      if (phase !== "playing") return;
      const q = questions[index];
      if (!q) return;
      const msUsed = Date.now() - questionStart.current;
      const correct = optionId !== null && optionId === q.correctOptionId;
      const fraction = Math.max(0, Math.min(1, timeLeft / (q.seconds * 1000)));
      const speed = correct ? Math.round(q.points * (0.55 + 0.45 * fraction)) : 0;
      const bonus = correct ? Math.min(streak, 6) * 25 : 0;
      const gained = speed + bonus;

      setChosen(optionId);
      setPhase("reveal");
      setScore((s) => s + gained);
      setPop({
        id: Date.now(),
        text: correct ? `+${gained}${bonus ? ` 🔥x${streak + 1}` : ""}` : optionId ? "Missed!" : "Time!",
        good: correct,
      });

      const nextStreak = correct ? streak + 1 : 0;
      setStreak(nextStreak);
      setMaxStreak((m) => Math.max(m, nextStreak));
      setAnswers((prev) => [
        ...prev,
        { questionId: q.id, chosenId: optionId, correct, points: gained, msUsed },
      ]);
    },
    [index, phase, questions, streak, timeLeft],
  );

  const next = useCallback(() => {
    if (index + 1 >= total) {
      finish(answers, score);
      return;
    }
    const nextIndex = index + 1;
    setIndex(nextIndex);
    setPhase("playing");
    beginQuestion(nextIndex);
  }, [answers, beginQuestion, finish, index, score, total]);

  // countdown
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 100) {
          clearInterval(id);
          return 0;
        }
        return t - 100;
      });
    }, 100);
    return () => clearInterval(id);
  }, [phase, index]);

  useEffect(() => {
    if (phase === "playing" && timeLeft === 0) submitAnswer(null);
  }, [phase, timeLeft, submitAnswer]);

  const start = useCallback(() => {
    startedAt.current = Date.now();
    setPhase("playing");
    beginQuestion(0);
  }, [beginQuestion]);

  // keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (phase === "playing" && question) {
        const n = Number(e.key);
        if (n >= 1 && n <= question.options.length) {
          const option = question.options[n - 1];
          if (!eliminated.includes(option.id)) submitAnswer(option.id);
        }
      } else if (phase === "reveal" && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        next();
      } else if (phase === "intro" && e.key === "Enter") {
        start();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [phase, question, eliminated, submitAnswer, next, start]);

  useEffect(() => {
    if (phase !== "results") return;
    fetch(`/api/quiz/${quiz.code}/attempt`)
      .then((r) => r.json())
      .then((d: { leaderboard?: LeaderRow[] }) => setLeaderboard(d.leaderboard ?? []))
      .catch(() => undefined);
  }, [phase, quiz.code]);

  const restart = () => {
    setIndex(0);
    setScore(0);
    setStreak(0);
    setMaxStreak(0);
    setAnswers([]);
    setLifelines({ fifty: 2, hint: 2, skip: 1 });
    setSaved(false);
    setSavingRank(null);
    setCelebrate(false);
    setPop(null);
    setChosen(null);
    setEliminated([]);
    setHintOpen(false);
    startedAt.current = Date.now();
    setPhase("playing");
    beginQuestion(0);
  };

  const useFifty = () => {
    if (lifelines.fifty <= 0 || phase !== "playing" || eliminated.length || !question) return;
    const wrong = question.options.filter((o) => o.id !== question.correctOptionId);
    const drop = wrong.slice(0, Math.max(1, question.options.length - 2)).map((o) => o.id);
    setEliminated(drop);
    setLifelines((l) => ({ ...l, fifty: l.fifty - 1 }));
  };

  const useHint = () => {
    if (lifelines.hint <= 0 || phase !== "playing" || hintOpen || !question) return;
    setHintOpen(true);
    setLifelines((l) => ({ ...l, hint: l.hint - 1 }));
    setScore((s) => Math.max(0, s - 30));
  };

  const useSkip = () => {
    if (lifelines.skip <= 0 || phase !== "playing" || !question) return;
    const skipped: Answer = {
      questionId: question.id,
      chosenId: null,
      correct: false,
      points: 0,
      msUsed: 0,
    };
    const nextAnswers = [...answers, skipped];
    setLifelines((l) => ({ ...l, skip: l.skip - 1 }));
    setAnswers(nextAnswers);
    setStreak(0);
    if (index + 1 >= total) {
      finish(nextAnswers, score);
    } else {
      const nextIndex = index + 1;
      setIndex(nextIndex);
      beginQuestion(nextIndex);
    }
  };

  const correctCount = answers.filter((a) => a.correct).length;
  const accuracy = answers.length ? correctCount / answers.length : 0;
  const rank = useMemo(() => rankFor(accuracy), [accuracy]);

  const saveScore = async () => {
    if (saved) return;
    setSaved(true);
    try {
      const res = await fetch(`/api/quiz/${quiz.code}/attempt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerName: playerName.trim() || "Anonymous",
          score,
          correct: correctCount,
          total,
          maxStreak,
          durationMs: Date.now() - startedAt.current,
        }),
      });
      const data = (await res.json()) as { leaderboard?: LeaderRow[]; rank?: number | null };
      setLeaderboard(data.leaderboard ?? []);
      setSavingRank(data.rank ?? null);
    } catch {
      setSaved(false);
    }
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  /* ---------------------------------- INTRO --------------------------------- */
  if (phase === "intro") {
    return (
      <div className="animate-slide glass glow-ring mx-auto max-w-3xl rounded-3xl p-8 text-center sm:p-12">
        <div className="animate-float mx-auto mb-5 grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-violet-500 via-fuchsia-500 to-cyan-400 text-4xl shadow-2xl shadow-violet-900/50">
          🎯
        </div>
        <p className="text-xs font-black uppercase tracking-[0.25em] text-cyan-300">Quiz ready</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">{quiz.title}</h1>
        <p className="mt-3 text-white/60">{quiz.subtitle}</p>

        <div className="mx-auto mt-7 grid max-w-lg grid-cols-3 gap-3 text-center">
          {[
            { label: "Questions", value: total, emoji: "❓" },
            { label: "Max score", value: questions.reduce((s, q) => s + q.points + 150, 0), emoji: "🏆" },
            { label: "Source words", value: quiz.wordCount.toLocaleString(), emoji: "📚" },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="text-lg">{stat.emoji}</div>
              <div className="text-lg font-black">{stat.value}</div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {quiz.keywords.length > 0 && (
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            {quiz.keywords.slice(0, 8).map((k) => (
              <span
                key={k}
                className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-xs font-semibold text-white/70"
              >
                #{k.replace(/\s+/g, "")}
              </span>
            ))}
          </div>
        )}

        <div className="mt-8 grid gap-3 text-left sm:grid-cols-3">
          {[
            { emoji: "⏱️", title: "Beat the clock", body: "Faster answers score more points." },
            { emoji: "🔥", title: "Build streaks", body: "Every streak level adds +25 bonus." },
            { emoji: "🛟", title: "3 lifelines", body: "50:50 ×2, hint ×2 and one skip." },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="text-xl">{item.emoji}</div>
              <p className="mt-1 text-sm font-bold">{item.title}</p>
              <p className="text-xs text-white/55">{item.body}</p>
            </div>
          ))}
        </div>

        <button
          onClick={start}
          className="mt-8 w-full rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 px-8 py-4 text-lg font-black text-white shadow-xl shadow-violet-900/40 transition hover:brightness-110 active:scale-[0.99]"
        >
          Start the game →
        </button>
        <p className="mt-3 text-xs text-white/40">
          Tip: press <kbd className="rounded bg-white/10 px-1.5 py-0.5">1</kbd>–
          <kbd className="rounded bg-white/10 px-1.5 py-0.5">4</kbd> to answer with the keyboard.
        </p>
      </div>
    );
  }

  /* --------------------------------- RESULTS -------------------------------- */
  if (phase === "results") {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        {celebrate && <Confetti />}
        <div className="animate-slide glass glow-ring rounded-3xl p-8 text-center">
          <div
            className={`mx-auto grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br ${rank.tone} text-4xl shadow-2xl`}
          >
            {rank.emoji}
          </div>
          <p className="mt-4 text-xs font-black uppercase tracking-[0.25em] text-white/50">
            Final rank
          </p>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">{rank.title}</h1>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Score", value: score.toLocaleString() },
              { label: "Correct", value: `${correctCount}/${total}` },
              { label: "Accuracy", value: `${Math.round(accuracy * 100)}%` },
              { label: "Best streak", value: `🔥 ${maxStreak}` },
            ].map((s) => (
              <div key={s.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xl font-black text-gradient">{s.value}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-white/45">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              maxLength={24}
              placeholder="Your name for the leaderboard"
              disabled={saved}
              className="flex-1 rounded-xl border border-white/12 bg-black/30 px-4 py-3 text-sm font-semibold outline-none transition placeholder:text-white/30 focus:border-violet-400/70 disabled:opacity-60"
            />
            <button
              onClick={saveScore}
              disabled={saved}
              className="rounded-xl bg-gradient-to-r from-lime-400 to-emerald-400 px-6 py-3 text-sm font-black text-black transition hover:brightness-110 disabled:opacity-60"
            >
              {saved ? (savingRank ? `Saved · #${savingRank}` : "Saved ✓") : "Save score"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <button
              onClick={restart}
              className="rounded-xl border border-white/15 bg-white/8 px-5 py-2.5 text-sm font-bold transition hover:bg-white/15"
            >
              🔁 Play again
            </button>
            <button
              onClick={share}
              className="rounded-xl border border-white/15 bg-white/8 px-5 py-2.5 text-sm font-bold transition hover:bg-white/15"
            >
              {copied ? "🔗 Link copied!" : "🔗 Challenge a friend"}
            </button>
            <Link
              href="/"
              className="rounded-xl border border-white/15 bg-white/8 px-5 py-2.5 text-sm font-bold transition hover:bg-white/15"
            >
              📄 New document
            </Link>
          </div>
        </div>

        {leaderboard.length > 0 && (
          <div className="glass animate-slide rounded-3xl p-6">
            <h2 className="mb-4 text-lg font-black">🏆 Leaderboard</h2>
            <ol className="space-y-2">
              {leaderboard.map((row, i) => (
                <li
                  key={row.id}
                  className="flex items-center gap-3 rounded-xl border border-white/8 bg-white/5 px-4 py-2.5"
                >
                  <span className="w-7 text-center text-sm font-black text-white/60">
                    {["🥇", "🥈", "🥉"][i] ?? i + 1}
                  </span>
                  <span className="flex-1 truncate text-sm font-bold">{row.playerName}</span>
                  <span className="text-xs text-white/45">
                    {row.correct}/{row.total} · 🔥{row.maxStreak}
                  </span>
                  <span className="w-20 text-right text-sm font-black text-gradient">
                    {row.score.toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        <div className="glass rounded-3xl p-6">
          <h2 className="mb-4 text-lg font-black">📝 Review</h2>
          <div className="space-y-3">
            {questions.map((q, i) => {
              const answer = answers.find((a) => a.questionId === q.id);
              const correctOption = q.options.find((o) => o.id === q.correctOptionId);
              const chosenOption = q.options.find((o) => o.id === answer?.chosenId);
              return (
                <details
                  key={q.id}
                  className="group rounded-2xl border border-white/10 bg-white/[0.04] p-4 open:bg-white/[0.07]"
                >
                  <summary className="flex cursor-pointer list-none items-start gap-3">
                    <span
                      className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg text-xs font-black ${
                        answer?.correct ? "bg-lime-400 text-black" : "bg-rose-500 text-white"
                      }`}
                    >
                      {answer?.correct ? "✓" : "✕"}
                    </span>
                    <span className="flex-1 text-sm font-semibold leading-relaxed">
                      <span className="text-white/40">Q{i + 1}. </span>
                      {renderPrompt(q.prompt)}
                    </span>
                  </summary>
                  <div className="mt-3 space-y-1.5 pl-9 text-sm">
                    {!answer?.correct && (
                      <p className="text-rose-300">
                        You: {chosenOption?.text ?? "no answer"}
                      </p>
                    )}
                    <p className="text-lime-300">Answer: {correctOption?.text}</p>
                    <p className="text-white/55">{q.explanation}</p>
                  </div>
                </details>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  /* --------------------------------- PLAYING -------------------------------- */
  const fraction = timeLeft / (question.seconds * 1000);
  const danger = fraction < 0.3;
  const circumference = 2 * Math.PI * 26;

  return (
    <div className="mx-auto max-w-3xl">
      {/* HUD */}
      <div className="glass mb-4 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-widest text-white/45">Score</span>
          <span className="text-xl font-black text-gradient tabular-nums">
            {score.toLocaleString()}
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-black transition ${
            streak >= 2
              ? "border-orange-300/50 bg-orange-400/20 text-orange-200 animate-pulse-glow"
              : "border-white/10 bg-white/5 text-white/50"
          }`}
        >
          🔥 {streak} streak
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={useFifty}
            disabled={lifelines.fifty === 0 || phase !== "playing" || eliminated.length > 0}
            title="Remove two wrong answers"
            className="rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-xs font-bold transition hover:bg-white/15 disabled:opacity-30"
          >
            ½ <span className="text-white/40">{lifelines.fifty}</span>
          </button>
          <button
            onClick={useHint}
            disabled={lifelines.hint === 0 || phase !== "playing" || hintOpen}
            title="Reveal a hint (−30 pts)"
            className="rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-xs font-bold transition hover:bg-white/15 disabled:opacity-30"
          >
            💡 <span className="text-white/40">{lifelines.hint}</span>
          </button>
          <button
            onClick={useSkip}
            disabled={lifelines.skip === 0 || phase !== "playing"}
            title="Skip this question"
            className="rounded-lg border border-white/12 bg-white/5 px-2.5 py-1.5 text-xs font-bold transition hover:bg-white/15 disabled:opacity-30"
          >
            ⏭ <span className="text-white/40">{lifelines.skip}</span>
          </button>
        </div>
      </div>

      {/* progress dots */}
      <div className="mb-4 flex gap-1">
        {questions.map((q, i) => (
          <div
            key={q.id}
            className={`h-1.5 flex-1 rounded-full transition-all ${
              i < index
                ? answers[i]?.correct
                  ? "bg-lime-400"
                  : "bg-rose-500/70"
                : i === index
                  ? "bg-white/80"
                  : "bg-white/12"
            }`}
          />
        ))}
      </div>

      <div key={question.id} className="animate-pop glass glow-ring relative rounded-3xl p-6 sm:p-8">
        {pop && (
          <span
            key={pop.id}
            className={`animate-score pointer-events-none absolute right-8 top-16 z-10 text-2xl font-black ${
              pop.good ? "text-lime-300" : "text-rose-300"
            }`}
          >
            {pop.text}
          </span>
        )}

        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white/60">
              {index + 1} / {total}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-black uppercase tracking-wider ${DIFF_COLOR[question.difficulty]}`}
            >
              {question.difficulty}
            </span>
            <span className="rounded-full border border-white/12 bg-white/5 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-white/60">
              {TYPE_LABEL[question.type]}
            </span>
          </div>

          <div className="relative shrink-0">
            <svg width="62" height="62" className="-rotate-90">
              <circle cx="31" cy="31" r="26" stroke="rgba(255,255,255,0.12)" strokeWidth="5" fill="none" />
              <circle
                cx="31"
                cy="31"
                r="26"
                stroke={danger ? "#fb7185" : "#22d3ee"}
                strokeWidth="5"
                fill="none"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - Math.max(0, fraction))}
                style={{ transition: "stroke-dashoffset 0.12s linear" }}
              />
            </svg>
            <span
              className={`absolute inset-0 grid place-items-center text-sm font-black tabular-nums ${
                danger ? "text-rose-300" : "text-white"
              }`}
            >
              {Math.ceil(timeLeft / 1000)}
            </span>
          </div>
        </div>

        <h2 className="text-xl font-bold leading-relaxed sm:text-2xl">
          {renderPrompt(question.prompt)}
        </h2>

        {hintOpen && (
          <p className="animate-pop mt-4 rounded-xl border border-amber-300/30 bg-amber-400/10 px-4 py-3 text-sm font-semibold text-amber-200">
            💡 {question.hint}
          </p>
        )}

        <div className={`mt-6 grid gap-3 ${question.options.length === 2 ? "sm:grid-cols-2" : ""}`}>
          {question.options.map((option, i) => {
            const isGone = eliminated.includes(option.id);
            const isCorrect = option.id === question.correctOptionId;
            const isChosen = option.id === chosen;
            const revealed = phase === "reveal";

            let style =
              "border-white/12 bg-white/[0.04] hover:border-violet-400/60 hover:bg-violet-500/15";
            if (revealed && isCorrect) style = "border-lime-400 bg-lime-400/20 text-lime-50";
            else if (revealed && isChosen) style = "border-rose-400 bg-rose-500/20 text-rose-50";
            else if (revealed) style = "border-white/8 bg-white/[0.02] opacity-50";

            return (
              <button
                key={option.id}
                disabled={revealed || isGone}
                onClick={() => submitAnswer(option.id)}
                className={`group flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left text-[15px] font-semibold transition-all active:scale-[0.995] ${style} ${
                  isGone ? "pointer-events-none opacity-20 line-through" : ""
                } ${revealed && isChosen && !isCorrect ? "animate-shake" : ""}`}
              >
                <span
                  className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg text-xs font-black transition ${
                    revealed && isCorrect
                      ? "bg-lime-400 text-black"
                      : revealed && isChosen
                        ? "bg-rose-500 text-white"
                        : "bg-white/10 text-white/70 group-hover:bg-violet-500/60 group-hover:text-white"
                  }`}
                >
                  {revealed && isCorrect ? "✓" : revealed && isChosen ? "✕" : LETTERS[i]}
                </span>
                <span className="flex-1 leading-snug">{option.text}</span>
              </button>
            );
          })}
        </div>

        {phase === "reveal" && (
          <div className="animate-pop mt-6 rounded-2xl border border-white/10 bg-black/25 p-4">
            <p className="text-xs font-black uppercase tracking-widest text-cyan-300">
              {answers[answers.length - 1]?.correct ? "Nailed it" : "From the document"}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-white/75">{question.explanation}</p>
            <button
              onClick={next}
              autoFocus
              className="mt-4 w-full rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-cyan-400 px-6 py-3 text-sm font-black text-white transition hover:brightness-110"
            >
              {index + 1 >= total ? "See my results 🏁" : "Next question →"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
