# Chess Coach

A personal AI chess coaching app focused on adaptive training, conversational game review, and context-aware live coaching.

## Current build

### Home and training
- Light productivity-style application shell
- Optional daily recommendations plus unrestricted self-serve navigation
- Puzzles, Learn, Openings, Analyze, and Progress areas

### Play with Coach
- Legal-move chessboard
- You play White against limited-strength Stockfish
- Selectable opponent strength
- Coach modes: Normal, Guided, Minimal, Assessment, Ask only
- AI coach can decide whether to intervene or stay quiet
- AI coach can pause the training game when a discussion is worth having
- Text conversation is grounded in board state and engine evidence

### Analyze
- Chess.com public-game import by username
- PGN upload and PGN paste
- Game library and replay
- Server-side Stockfish analysis of the student's moves
- Critical-position identification and phase/error summaries
- Contextual back-and-forth coach chat while reviewing any position

### Progress
- Aggregates evidence from analyzed games
- Tracks blunders/mistakes, missed forcing opportunities, and phase-level centipawn loss
- Current learning priorities become evidence-driven as games are analyzed

## Architecture

- `server.mjs` — Node HTTP app, Chess.com PubAPI, analysis/coach endpoints
- `lib/stockfish.mjs` — UCI Stockfish process integration
- `lib/game-analysis.mjs` — PGN analysis and structured move evidence
- `lib/coach.mjs` — OpenAI Responses API coaching layer
- `public/app.js` — client app, chess state, imports, training games, replay, coach UI
- `public/styles.css` — light responsive design system
- `coach-system-prompt.md` — coaching methodology and intervention policy
- `PRODUCT.md` — product direction

## Environment

`OPENAI_API_KEY` is required for conversational AI coaching. Stockfish play and game analysis work without it.

Optional:
- `OPENAI_MODEL` — defaults to `gpt-5.6-terra`
- `STOCKFISH_PATH` — defaults to `/usr/games/stockfish` in the Railway image

## Run locally

The Railway Docker image installs Stockfish automatically.

```bash
npm install
npm start
```

For local Stockfish features, install Stockfish and set `STOCKFISH_PATH` if it is not on your PATH.

## Railway

The project deploys automatically from `rems3n/chess-coach` `main`, uses Railway's injected `PORT`, and exposes `/health`.


## Puzzle mastery and spaced repetition

Personal puzzle training is generated from critical positions in analyzed games.

- Stable puzzle IDs tie review history to the original game position.
- Every attempt records correctness, response time, hints used, streak, mastery, and next review time.
- Missed puzzles return after 10 minutes.
- Clean first-try solves expand review intervals from 1 day to 3, 7, 14, 30, 60, and 90 days.
- Assisted solves receive shorter reinforcement intervals.
- The For You queue prioritizes overdue and low-mastery positions, then new positions.
- Filters support Due, New, Mastered, and All positions.
- Sessions can be limited to 5, 10, 20, or all available positions.
- Stockfish PVs turn suitable positions into short multi-move calculation drills.
- AI puzzle coaching can be used conversationally; asking for help counts as assistance for mastery scheduling.
- Puzzle mastery feeds the Home recommendation and My Chess progress views.

For the personal MVP, mastery is persisted in browser localStorage under `cc_puzzle_mastery`. The data model is intentionally structured for a later move to Postgres/Supabase.
