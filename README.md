# QuizForge 2.0

QuizForge turns study material into timed quiz games. It keeps the original private, offline local-NLP generator and adds an optional LLM provider, OCR hook, authentication endpoints, a PostgreSQL adapter, and production security controls.

## Quick start

```bash
npm install
Copy-Item .env.example .env
npm start
```

Open `http://localhost:3000`. The default configuration uses the local engine and JSON storage, so it works without API keys or a database.

## Production configuration

Set these values in `.env` before deploying:

| Setting | Purpose |
| --- | --- |
| `NODE_ENV=production` | Enables production safeguards. |
| `JWT_SECRET` | A unique random secret of at least 32 characters. |
| `CORS_ORIGIN` | Comma-separated allowed web origins. |
| `STORE_DRIVER=postgres` + `DATABASE_URL` | Enables PostgreSQL persistence. |
| `QUIZ_ENGINE=gemini` + `GEMINI_API_KEY` | Enables Gemini 3.5 Flash source-grounded generation. |
| `QUIZ_ENGINE=openai` + `OPENAI_API_KEY` | Enables OpenAI source-grounded generation. |
| `OCR_ENABLED=true` | Enables image OCR using installed Tesseract. |

For PostgreSQL, enable the `pgcrypto` extension once, then run [`db/schema.sql`](db/schema.sql). The included JSON store is intended for local development only.

## Features

- PDF, DOCX, text, HTML, JSON, and image upload support
- Image OCR integration hook (Tesseract) with a safe opt-in configuration
- Local question generation fallback plus OpenAI-compatible generation abstraction
- Gemini 3.5 Flash support with `GEMINI_MODEL=gemini-3.5-flash`
- Deterministic source-grounding validation: every AI answer must occur in its exact supporting excerpt
- Answer explanations and hints preserved in every generated question
- Registration and sign-in API using bcrypt password hashes and expiring JWTs
- PostgreSQL repository adapter plus development JSON store
- Rate limiting, Helmet security headers, upload magic-byte validation, constrained CORS, payload limits, and request IDs
- Timed quiz play, lifelines, leaderboard, shareable links, and library
- Node test suite for local generation and security helpers

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/health` | Health status and configured providers |
| `POST` | `/api/auth/register` | Create account (`email`, `password`) |
| `POST` | `/api/auth/login` | Return an access token |
| `GET` | `/api/quizzes` | Recent public quizzes |
| `POST` | `/api/quiz/generate` | Generate from uploads or text |
| `GET` | `/api/quiz/:code` | Fetch a quiz |
| `GET/POST` | `/api/quiz/:code/attempt` | Leaderboard and score submission |

Pass `Authorization: Bearer <token>` to associate new quizzes with an authenticated user. The current UI remains anonymous-compatible to preserve the original flow.

New quizzes retain a source snapshot so **Generate new version** can create a versioned question set without replacing the original quiz. Source snapshots are not returned by the public API; use encrypted database storage and define a retention policy before production deployment.

## Scripts

| Command | Description |
| --- | --- |
| `npm start` | Run the app |
| `npm run dev` | Restart automatically during development |
| `npm test` | Run regression tests |
| `npm run start:production` | Launch with production environment |

## Important operational notes

- Treat uploaded content as untrusted; use a malware scanner at your storage/edge provider in production.
- The sample OCR integration invokes a locally installed Tesseract binary. For high-volume jobs, send uploads to a queue and a managed OCR worker instead.
- LLM output is normalized and restricted to source material by prompt, but should still be monitored and evaluated for educational accuracy.
- Configure HTTPS at the reverse proxy and set `CORS_ORIGIN` to your frontend domain.
