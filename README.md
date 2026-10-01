# Chess Coach

A personal AI chess coaching app focused on adaptive training, conversational game review, and context-aware live coaching.

## Sprint 1

The first vertical slice includes:

- Light productivity-style application shell
- Home dashboard with optional daily recommendations and unrestricted self-serve training
- Interactive chessboard with legal move validation
- Coaching conversation UI and coaching-mode controls
- Chess.com public game import by username
- PGN upload and paste import
- Imported game library and full move replay
- Learn, Puzzles, Openings, and Progress product shells
- Mobile-responsive navigation and board layouts

The AI coach and engine are intentionally separated from the UI. Sprint 2 will wire the current board/game context to Stockfish analysis and the coaching system prompt rather than returning generic engine narration.

## Architecture

- `server.mjs` — dependency-free Node server, Chess.com PubAPI proxy, static app host
- `public/app.js` — client app, chess state, imports, replay, navigation
- `public/styles.css` — light design system and responsive layouts
- `coach-system-prompt.md` — draft coaching policy
- `PRODUCT.md` — current scope and product architecture

The browser uses `chess.js` as an ES module for move legality and PGN parsing.

## Run locally

```bash
npm start
```

Then open `http://localhost:3000`.

## Railway

The app uses Railway's injected `PORT` variable automatically and exposes `/health` for health checks.
