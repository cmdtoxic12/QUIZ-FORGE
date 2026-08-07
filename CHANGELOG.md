# Changelog

## 2.1.0 - Gemini and source grounding

- Added Gemini support using `GEMINI_API_KEY` and `gemini-3.5-flash`.
- Added labelled source chunks, mandatory evidence quotes, and deterministic answer-evidence validation for LLM-generated questions.
- Added versioned quiz regeneration, preserving earlier quiz links and questions.

## 2.0.0 - Production foundation

- Added environment-based configuration and safe production validation.
- Added registration/login endpoints using bcrypt password hashing and JWT access tokens.
- Added optional PostgreSQL adapter and database schema; retained JSON store for local use.
- Added LLM generation abstraction with local NLP fallback and optional OpenAI implementation.
- Added image file acceptance, magic-byte validation, and opt-in Tesseract OCR extraction.
- Added security controls: Helmet, rate limiting, CORS allow-list, payload limits, filename sanitization, request IDs, and structured errors.
- Preserved existing quiz generation, play, leaderboard, and library behavior.
- Added local-engine and security helper tests plus production deployment documentation.

## Known production extensions

Queued processing, object storage, malware scanning, password reset/email verification, and full account UI are deployment-integrated concerns and should be connected to the chosen cloud providers.
