# QuizForge

Turn documents into timed arcade quiz games. Upload PDF, DOCX, TXT, MD, CSV, JSON or HTML — a local NLP agent (or optional LLM) builds questions with distractors, streaks, lifelines and a leaderboard.

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL to point at Postgres
npm install
npx drizzle-kit push   # apply schema (or generate + migrate)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Postgres connection string |
| `OPENAI_API_KEY` | No | Enables OpenAI quiz generation |
| `ANTHROPIC_API_KEY` | No | Enables Anthropic |
| `GEMINI_API_KEY` / `GOOGLE_API_KEY` | No | Enables Gemini |

Without an LLM key the **local NLP engine** still builds quizzes from definitions, cloze blanks, figures, true/false and “which is true” items.

## Scripts

- `npm run dev` — development server
- `npm run build` / `npm start` — production
- `npm run lint` / `npm run typecheck`

## Notes

- Max 5 files per generate, 12 MB each
- Scanned / image-only PDFs are not supported (text layer required)
- Quiz codes are short shareable IDs under `/play/[code]`
