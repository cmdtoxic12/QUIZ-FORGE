import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export type QuizOption = {
  id: string;
  text: string;
};

export type QuizQuestion = {
  id: string;
  type: "multiple-choice" | "true-false" | "fill-blank" | "which-true";
  prompt: string;
  options: QuizOption[];
  correctOptionId: string;
  explanation: string;
  hint: string;
  difficulty: "easy" | "medium" | "hard";
  points: number;
  seconds: number;
  topic: string;
};

export const quizzes = pgTable(
  "quizzes",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 16 }).notNull().unique(),
    title: text("title").notNull(),
    subtitle: text("subtitle").notNull().default(""),
    sourceNames: jsonb("source_names").$type<string[]>().notNull().default([]),
    engine: varchar("engine", { length: 40 }).notNull().default("local"),
    difficulty: varchar("difficulty", { length: 20 }).notNull().default("mixed"),
    questionCount: integer("question_count").notNull().default(0),
    wordCount: integer("word_count").notNull().default(0),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    questions: jsonb("questions").$type<QuizQuestion[]>().notNull(),
    plays: integer("plays").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("quizzes_created_at_idx").on(table.createdAt)],
);

export const attempts = pgTable(
  "attempts",
  {
    id: serial("id").primaryKey(),
    quizId: integer("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    playerName: varchar("player_name", { length: 40 }).notNull(),
    score: integer("score").notNull().default(0),
    correct: integer("correct").notNull().default(0),
    total: integer("total").notNull().default(0),
    accuracy: real("accuracy").notNull().default(0),
    maxStreak: integer("max_streak").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("attempts_quiz_score_idx").on(table.quizId, table.score)],
);

export type QuizRow = typeof quizzes.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
