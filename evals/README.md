# Coach Evaluation Harness

This folder contains the regression suite for the chess coaching system.

## Goals

The harness measures whether the coach is:

- factually correct about the board
- consistent with verified Stockfish analysis
- careful about practical alternatives rather than treating every non-best move as a mistake
- pedagogically useful for a 1200–1500 player building toward 1800
- selective about when it intervenes
- fast enough for an interactive coaching product

## Seed corpus

`coach-cases.json` currently contains 20 seed scenarios covering:

- candidate-move challenges
- board-state factuality
- prior-position / last-decision analysis
- positional explanations
- practical move judgment
- unnecessary intervention
- assessment / ask-only behavior
- retries
- ambiguous natural-language questions
- avoiding invented tactics

The corpus should grow continuously from real production failures. Any time the coach gives materially wrong chess advice, turn that interaction into a permanent eval case.

## Running the harness

Hard checks only:

```bash
OPENAI_API_KEY=... STOCKFISH_PATH=/usr/games/stockfish npm run eval:coach
```

Hard checks plus structured LLM judging:

```bash
OPENAI_API_KEY=... STOCKFISH_PATH=/usr/games/stockfish npm run eval:coach -- --judge
```

Run a single case:

```bash
npm run eval:coach -- --judge --case=opening-spanish-capture
```

Limit the run:

```bash
npm run eval:coach -- --judge --max=5
```

Reports are written to:

- `evals/results/latest.json`
- `evals/results/latest.md`

## Grading

Hard checks currently cover:

- required silent behavior
- no-pause requirements
- presence of verified Stockfish packets
- correct use of the last-decision position
- candidate verification through either a verified MultiPV packet or the explicit candidate-verification tool
- latency instrumentation

The optional structured judge scores each response from 0–2 on:

- board factuality
- engine consistency
- practical judgment
- pedagogy
- level appropriateness
- intervention quality

A response is marked as a major error for illegal-move claims, false tactical assertions, contradiction of verified engine data, or materially misleading chess advice.

## Release target

Before treating a coaching prompt/model change as an improvement, target:

- **0 major chess errors**
- board factuality average **>= 1.9 / 2**
- engine consistency average **>= 1.9 / 2**
- practical judgment average **>= 1.8 / 2**
- pedagogy average **>= 1.7 / 2**
- intervention quality average **>= 1.7 / 2**

Latency should be tracked separately by interaction type rather than traded blindly against correctness.

## GitHub Actions

`Coach Evals` is a manual workflow because it uses paid model calls. It requires an `OPENAI_API_KEY` repository secret. Each run uploads the JSON and Markdown reports as a workflow artifact.

The normal regression workflow validates the eval corpus itself without making paid API calls.
