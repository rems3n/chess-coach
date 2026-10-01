# Chess Coach MVP

## Sprint 1 scope
- Light productivity-style UI
- Home / daily recommendation with unrestricted self-serve navigation
- Interactive Play board with legal move validation
- Analyze hub with Chess.com public game import, PGN upload and PGN paste
- Game library and replay
- Progress / My Chess shell
- Separation between game truth (engine), learner model, and AI teaching layer

## Next technical layers
1. Stockfish analysis service: FEN -> MultiPV/evaluation/lines
2. Structured move observations and error taxonomy
3. Persistent player profile and learning plan
4. AI coach tool interface and system prompt
5. Coached training game modes
6. Realtime voice

## Intended production stack
Long term: Next.js/TypeScript + Postgres/Supabase + Stockfish service + OpenAI Responses/Realtime. The Sprint 1 prototype intentionally has no framework dependencies so it can be deployed and iterated quickly while preserving the product architecture.
